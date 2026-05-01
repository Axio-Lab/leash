/**
 * STDIO-transport Leash MCP server.
 *
 * Builds an `@modelcontextprotocol/sdk` server, registers each
 * `LeashTool` from `@leash/mcp-core` against the standalone host,
 * and returns the configured `McpServer` ready for the caller to
 * connect to a transport (STDIO, HTTP, in-memory).
 *
 * The chat product wraps the same `LeashTool` set with the Claude
 * Agent SDK's `tool()` helper; this module wraps them with the MCP
 * SDK's `server.registerTool()`. Both call into the same `LeashHost`
 * methods — only the runtime adapter differs.
 *
 * Boot states
 * -----------
 * The server boots even when no agent is configured yet. In that
 * "no_agent" state every settlement/identity tool returns a recoverable
 * `{ status: "no_agent", … }` blob, but `leash_register_agent` is
 * fully functional — it hits `POST /v1/sandbox/agent`, writes
 * `~/.config/leash/agent.json`, AND swaps the in-memory host to a
 * real `StdioHost` so the LLM can immediately retry the failed tool
 * call without restarting the MCP host. That's the YC-demo flow.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  LEASH_TOOLS,
  fetchDiscover,
  fetchReputation,
  type CheckTreasuryBalanceArgs,
  type CreatePaymentLinkArgs,
  type DiscoverArgs,
  type GetIdentityArgs,
  type LeashHost,
  type LeashTool,
  type LeashToolResult,
  type PayArgs,
  type ReceiptsArgs,
  type RegisterAgentArgs,
  type ReputationArgs,
  type SvmNetwork,
  type WithdrawArgs,
} from '@leash/mcp-core';

import { defaultConfigPath, loadAgentConfig, type LeashAgentConfig } from './config.js';
import { writeAgentConfig } from './config-write.js';
import { createStdioHost } from './host-stdio.js';
import { postSandboxAgent } from './sandbox-api.js';

const SERVER_NAME = 'leash';
const SERVER_VERSION = '0.1.0';
const DEFAULT_API_URL = 'https://api.leash.market';

/**
 * Build the MCP server bound to the given host. Each `LeashTool`
 * gets registered via the SDK's `tool()` overload.
 *
 * `LeashTool.handler` receives `args, ctx`; we close over `host` so
 * the MCP-SDK callback shape (`(args) => …`) lines up.
 */
export function createLeashMcpServer(host: LeashHost): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  for (const def of LEASH_TOOLS) {
    registerLeashTool(server, def, host);
  }

  return server;
}

/**
 * Register one shared `LeashTool` against an MCP server instance.
 * Pulled out of the loop so the type-cast surface is small.
 *
 * We use the `tool(name, description, paramsSchema, cb)` overload
 * (rather than the newer `registerTool` config-object form) because
 * its generics flow better through our erased `LeashTool` type:
 * `registerTool` infers `InputArgs = undefined` when the schema is
 * widened, which then rejects our `(args) => Promise<...>` callback.
 *
 * `tool()` is marked `@deprecated` in the SDK but still functions
 * identically — we'll migrate when MCP-SDK v2 lands.
 */
function registerLeashTool(server: McpServer, def: LeashTool, host: LeashHost): void {
  const shape =
    (def.inputSchema as unknown as { shape?: Record<string, unknown> }).shape ??
    (def.inputSchema as unknown as Record<string, unknown>);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.tool as any)(def.name, def.description, shape, async (args: unknown) =>
    def.handler(args, host),
  );
}

/**
 * High-level convenience: load on-disk config + env overrides, build
 * a swappable `HostRef`, build the server. The `HostRef` is what
 * lets `leash_register_agent` mutate the in-memory host without
 * tearing down the MCP connection.
 */
export function buildServerFromEnv(opts?: { configPath?: string }): {
  server: McpServer;
  config: LeashAgentConfig | null;
  /** The mutable host wrapper. Useful for tests asserting state changes. */
  hostRef: HostRef;
} {
  const configPath = opts?.configPath ?? defaultConfigPath();
  const config = loadAgentConfig(opts?.configPath ? { path: configPath } : {});

  const initialInner: LeashHost = config ? createStdioHost(config) : makePlaceholderHost();
  const hostRef = new HostRef(initialInner, configPath);

  return { server: createLeashMcpServer(hostRef), config, hostRef };
}

/**
 * Run the MCP server on STDIO. Blocks the event loop until the
 * client disconnects. Logs to stderr only — STDOUT is reserved
 * for the JSON-RPC framed messages.
 */
export async function runStdioServer(opts?: { configPath?: string }): Promise<void> {
  const { server, config } = buildServerFromEnv(opts);
  if (config) {
    process.stderr.write(
      `[leash-mcp] ready  agent=${config.agentMint}  network=${config.network}  executive=${maskPubkey(loadExecPubkey(config))}\n`,
    );
  } else {
    process.stderr.write(
      `[leash-mcp] ready (no agent configured — call leash_register_agent or set ~/.config/leash/agent.json)\n`,
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function loadExecPubkey(config: LeashAgentConfig): string {
  const host = createStdioHost(config);
  return host.ownerWallet ?? '<unknown>';
}

function maskPubkey(pk: string): string {
  if (pk.length < 12) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// HostRef — swappable LeashHost wrapper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a `LeashHost` so `registerAgent` can replace the underlying
 * implementation in place. Forwards every standard method to the
 * current `inner` host; intercepts `registerAgent` to handle the
 * placeholder → real-host upgrade.
 *
 * We use a class with explicit forwarders (rather than a Proxy) so
 * the TypeScript surface stays tight and readers can see exactly
 * what each method does.
 */
export class HostRef implements LeashHost {
  private inner: LeashHost;
  private readonly configPath: string;

  constructor(inner: LeashHost, configPath: string) {
    this.inner = inner;
    this.configPath = configPath;
  }

  /** Test/inspection hook. Not part of the `LeashHost` contract. */
  getInner(): LeashHost {
    return this.inner;
  }

  // ── identity getters (delegate to inner) ──
  get agentMint(): string | null {
    return this.inner.agentMint;
  }
  get ownerWallet(): string | null {
    return this.inner.ownerWallet;
  }
  get network(): SvmNetwork {
    return this.inner.network;
  }
  get rpcUrl(): string {
    return this.inner.rpcUrl;
  }
  get apiBaseUrl(): string {
    return this.inner.apiBaseUrl;
  }

  // ── settlement methods — pure delegation ──
  createPaymentLink(args: CreatePaymentLinkArgs): Promise<LeashToolResult> {
    return this.inner.createPaymentLink(args);
  }
  pay(args: PayArgs): Promise<LeashToolResult> {
    return this.inner.pay(args);
  }
  withdraw(args: WithdrawArgs): Promise<LeashToolResult> {
    return this.inner.withdraw(args);
  }
  checkTreasuryBalance(args: CheckTreasuryBalanceArgs): Promise<LeashToolResult> {
    return this.inner.checkTreasuryBalance(args);
  }
  getIdentity(args: GetIdentityArgs): Promise<LeashToolResult> {
    return this.inner.getIdentity(args);
  }
  receipts(args: ReceiptsArgs): Promise<LeashToolResult> {
    return this.inner.receipts(args);
  }
  discover(args: DiscoverArgs): Promise<LeashToolResult> {
    return this.inner.discover(args);
  }
  reputation(args: ReputationArgs): Promise<LeashToolResult> {
    return this.inner.reputation(args);
  }

  // ── registerAgent — the only method that can mutate `this.inner` ──
  async registerAgent(args: RegisterAgentArgs): Promise<LeashToolResult> {
    // If we already have an agent, the inner host's "already_registered"
    // path is the right answer.
    if (this.inner.agentMint) {
      return this.inner.registerAgent(args);
    }

    const apiBaseUrl =
      process.env.LEASH_API_URL?.trim() || this.inner.apiBaseUrl || DEFAULT_API_URL;

    try {
      const sandbox = await postSandboxAgent({
        apiBaseUrl,
        body: { ...(args.name ? { name: args.name } : {}) },
      });

      const newConfig: LeashAgentConfig = {
        agentMint: sandbox.mint,
        executiveSecretBase58: sandbox.executive_secret_base58,
        network: sandbox.network,
        apiBaseUrl,
        rpcUrl: process.env.LEASH_RPC_URL?.trim() || defaultRpcFor(sandbox.network),
        apiKey: process.env.LEASH_API_KEY?.trim() || null,
      };

      let configWrittenTo: string | null = null;
      try {
        configWrittenTo = await writeAgentConfig({
          config: newConfig,
          path: this.configPath,
        });
      } catch (err) {
        // Disk write failures aren't fatal — the in-memory swap below
        // still upgrades the host for this session. Surface a warning
        // so the user knows they'll need to repeat `leash_register_agent`
        // (or save the secret manually) before the next launch.
        process.stderr.write(
          `[leash-mcp] warning: failed to persist ~/.config/leash/agent.json: ${
            err instanceof Error ? err.message : 'unknown'
          }\n`,
        );
      }

      // Hot-swap the inner host. All subsequent tool calls will
      // hit the real signer + RPC.
      this.inner = createStdioHost(newConfig);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              kind: 'register_agent',
              status: 'ok',
              agent_mint: sandbox.mint,
              treasury_address: sandbox.treasury,
              executive_pubkey: sandbox.executive_pubkey,
              network: sandbox.network,
              funded_with: {
                sol_lamports: sandbox.funded.sol_lamports,
                usdc_atomic: sandbox.funded.usdc_atomic,
              },
              tx_signatures: sandbox.tx_signatures,
              explorer_url: sandbox.explorer_urls.mint,
              config_written_to: configWrittenTo,
              note: 'Agent is fully provisioned and the in-memory MCP host is now bound to it. Subsequent tool calls (leash_pay_payment_link, leash_check_treasury_balance, etc.) will use this agent immediately — no MCP restart required. The executive secret was persisted to the config file with chmod 600.',
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              kind: 'register_agent',
              status: 'error',
              message: err instanceof Error ? err.message : 'unknown error',
            }),
          },
        ],
      };
    }
  }
}

function defaultRpcFor(network: SvmNetwork): string {
  return network === 'solana-mainnet'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';
}

// ────────────────────────────────────────────────────────────────────────────
// Placeholder host
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stand-in `LeashHost` used when no agent is configured. Settlement
 * tools return a `no_agent` JSON blob via the host method, so the
 * LLM sees a recoverable error and is prompted to call
 * `leash_register_agent`. `registerAgent` itself is intercepted by
 * `HostRef` so the placeholder never sees that call.
 */
function makePlaceholderHost(): LeashHost {
  // Discovery + reputation are public read-only endpoints — they
  // don't need a configured agent. We still bind them to a sensible
  // default API base / network so the placeholder is fully useful
  // for "look around the marketplace before you mint" UX.
  const apiBaseUrl = process.env.LEASH_API_URL?.trim() || DEFAULT_API_URL;
  const network: SvmNetwork = 'solana-devnet';

  const noAgent = (kind: string): LeashToolResult => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          kind,
          status: 'no_agent',
          message:
            'No Leash agent configured. Call `leash_register_agent` (devnet, auto-funded) or set LEASH_AGENT_MINT + LEASH_EXECUTIVE_KEY in the environment, or write ~/.config/leash/agent.json. See https://leash.market/docs/mcp/install for details.',
        }),
      },
    ],
  });
  return {
    agentMint: null,
    ownerWallet: null,
    network,
    rpcUrl: 'https://api.devnet.solana.com',
    apiBaseUrl,
    async createPaymentLink() {
      return noAgent('payment_link');
    },
    async pay() {
      return noAgent('payment_receipt');
    },
    async withdraw() {
      return noAgent('withdraw_receipt');
    },
    async checkTreasuryBalance() {
      return noAgent('treasury_balance');
    },
    async getIdentity() {
      return noAgent('identity');
    },
    async receipts() {
      return noAgent('receipts');
    },
    async registerAgent() {
      // HostRef intercepts this call before it ever reaches us.
      // Implementing it as a no_agent passthrough is purely defensive.
      return noAgent('register_agent');
    },
    async discover(args) {
      return fetchDiscover({ apiBaseUrl, network, query: args });
    },
    async reputation(args) {
      return fetchReputation({ apiBaseUrl, network, query: args });
    },
  };
}

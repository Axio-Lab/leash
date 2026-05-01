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
 * The server boots in three states, all of which surface working
 * tool schemas to the LLM:
 *
 *   1. **Registered.** `agent.json` has a mint + executive. The
 *      placeholder is never installed — the inner host is a real
 *      `StdioHost` from the start.
 *
 *   2. **Awaiting funding.** A previous `leash_register_agent` call
 *      generated (or imported) an executive keypair but the user
 *      hasn't sent it SOL yet. `agent.json` carries a
 *      `pending_register` block. Settlement tools return `no_agent`;
 *      the next `leash_register_agent` call resumes from the
 *      persisted pending block, balance-checks, and mints if funded.
 *
 *   3. **Fresh.** No agent state on disk. Settlement tools return
 *      `no_agent`; the first `leash_register_agent` call generates
 *      (or imports) a keypair, persists it, and returns
 *      `funding_required`.
 *
 * In every state `leash_register_agent` is fully functional, hot-swaps
 * the in-memory host, and persists state to disk so the LLM can
 * recover without restarting the MCP host.
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

import {
  defaultConfigPath,
  loadAgentSession,
  type AgentSession,
  type LeashAgentConfig,
  type LeashHostDefaults,
  type PendingRegister,
} from './config.js';
import { writeAgentConfig, writePendingRegister } from './config-write.js';
import { createStdioHost } from './host-stdio.js';
import {
  RECOMMENDED_FUND_LAMPORTS,
  RECOMMENDED_FUND_SOL,
  generateExecutive,
  getExecutiveBalanceLamports,
  importExecutive,
  lamportsToSol,
  mintAgentLocally,
  type ExecutiveKeypair,
} from './mint-local.js';

const SERVER_NAME = 'leash';
const SERVER_VERSION = '0.2.0';

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
  pending: PendingRegister | null;
  defaults: LeashHostDefaults;
  /** The mutable host wrapper. Useful for tests asserting state changes. */
  hostRef: HostRef;
} {
  const configPath = opts?.configPath ?? defaultConfigPath();
  const session: AgentSession = loadAgentSession(opts?.configPath ? { path: configPath } : {});

  const initialInner: LeashHost = session.config
    ? createStdioHost(session.config)
    : makePlaceholderHost(session.defaults);
  const hostRef = new HostRef({
    inner: initialInner,
    configPath,
    defaults: session.defaults,
    pending: session.pending,
  });

  return {
    server: createLeashMcpServer(hostRef),
    config: session.config,
    pending: session.pending,
    defaults: session.defaults,
    hostRef,
  };
}

/**
 * Run the MCP server on STDIO. Blocks the event loop until the
 * client disconnects. Logs to stderr only — STDOUT is reserved
 * for the JSON-RPC framed messages.
 */
export async function runStdioServer(opts?: { configPath?: string }): Promise<void> {
  const { server, config, pending, defaults } = buildServerFromEnv(opts);
  if (config) {
    process.stderr.write(
      `[leash-mcp] ready  agent=${config.agentMint}  network=${config.network}  executive=${maskPubkey(loadExecPubkey(config))}\n`,
    );
  } else if (pending) {
    process.stderr.write(
      `[leash-mcp] ready (awaiting funding) network=${pending.network} executive=${maskPubkey(pending.executivePubkey)} — send ${RECOMMENDED_FUND_SOL} SOL to that address, then call leash_register_agent again\n`,
    );
  } else {
    process.stderr.write(
      `[leash-mcp] ready (no agent configured) network=${defaults.network} — call leash_register_agent to provision one\n`,
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
 * placeholder → pending → registered upgrade chain.
 *
 * We use a class with explicit forwarders (rather than a Proxy) so
 * the TypeScript surface stays tight and readers can see exactly
 * what each method does.
 */
export class HostRef implements LeashHost {
  private inner: LeashHost;
  private readonly configPath: string;
  private defaults: LeashHostDefaults;
  private pending: PendingRegister | null;

  constructor(args: {
    inner: LeashHost;
    configPath: string;
    defaults: LeashHostDefaults;
    pending: PendingRegister | null;
  }) {
    this.inner = args.inner;
    this.configPath = args.configPath;
    this.defaults = args.defaults;
    this.pending = args.pending;
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

  /**
   * Two-step registration:
   *   - First call: select keypair (generate / import), persist
   *     `pending_register`, return `funding_required` with the pubkey
   *     and minimum SOL amount.
   *   - Second call: resume from `pending_register`, balance-check,
   *     mint + delegate + record, write final `agent.json`, hot-swap.
   */
  async registerAgent(args: RegisterAgentArgs): Promise<RegisterResultLike> {
    if (this.inner.agentMint) {
      return this.inner.registerAgent(args);
    }

    try {
      const executive = this.pending
        ? this.executiveFromPending(this.pending)
        : await this.selectExecutive(args);

      const network = this.pending?.network ?? this.defaults.network;
      const balance = await getExecutiveBalanceLamports({
        rpcUrl: this.defaults.rpcUrl,
        pubkey: executive.pubkey,
      });

      if (balance < RECOMMENDED_FUND_LAMPORTS) {
        if (!this.pending) {
          // First call — persist the keypair before returning so the
          // user can shut down the MCP host while funding and resume
          // later without losing the secret.
          const newPending: PendingRegister = {
            executiveSecretBase58: executive.secretBase58,
            executivePubkey: executive.pubkey,
            network,
            createdAt: new Date().toISOString(),
          };
          await this.persistPending(newPending);
          this.pending = newPending;
        }
        return fundingRequiredResult({
          executive: executive.pubkey,
          network,
          balanceLamports: balance,
          requiredLamports: RECOMMENDED_FUND_LAMPORTS,
          configPath: this.configPath,
          imported: !!args.executive_secret_base58,
        });
      }

      // Funded — proceed with mint + delegate + record.
      const minted = await mintAgentLocally({
        executive,
        network,
        rpcUrl: this.defaults.rpcUrl,
        apiBaseUrl: this.defaults.apiBaseUrl,
        apiKey: this.defaults.apiKey,
        ...(args.name ? { name: args.name } : {}),
      });

      const finalConfig: LeashAgentConfig = {
        agentMint: minted.mint,
        executiveSecretBase58: executive.secretBase58,
        network: minted.network,
        apiBaseUrl: this.defaults.apiBaseUrl,
        rpcUrl: this.defaults.rpcUrl,
        explorerBaseUrl: this.defaults.explorerBaseUrl,
        apiKey: this.defaults.apiKey,
      };

      let configWrittenTo: string | null = null;
      try {
        configWrittenTo = await writeAgentConfig({
          config: finalConfig,
          path: this.configPath,
        });
      } catch (err) {
        process.stderr.write(
          `[leash-mcp] warning: failed to persist ~/.config/leash/agent.json: ${
            err instanceof Error ? err.message : 'unknown'
          }\n`,
        );
      }

      // Hot-swap. Subsequent tool calls hit the real signer + RPC.
      this.inner = createStdioHost(finalConfig);
      this.pending = null;

      return jsonOk({
        kind: 'register_agent',
        status: 'ok',
        agent_mint: minted.mint,
        treasury_address: minted.treasury,
        executive_pubkey: minted.executivePubkey,
        network: minted.network,
        tx_signatures: minted.txSignatures,
        receipts_service_url: minted.receiptsServiceUrl,
        config_written_to: configWrittenTo,
        note: 'Agent provisioned and recorded. The in-memory MCP host is now bound to the new agent — settlement tools are ready to use without restarting. Executive secret persisted to the config file with chmod 600.',
      });
    } catch (err) {
      return jsonOk({
        kind: 'register_agent',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  // ── helpers ──

  private executiveFromPending(p: PendingRegister): ExecutiveKeypair {
    return {
      secretBase58: p.executiveSecretBase58,
      pubkey: p.executivePubkey,
    };
  }

  private async selectExecutive(args: RegisterAgentArgs): Promise<ExecutiveKeypair> {
    if (args.mode === 'import') {
      if (!args.executive_secret_base58) {
        throw new Error(
          'mode: "import" requires `executive_secret_base58` (64-byte ed25519 secret, base58-encoded)',
        );
      }
      return importExecutive(args.executive_secret_base58);
    }
    // Default + explicit "generate" — fresh keypair.
    return generateExecutive();
  }

  private async persistPending(pending: PendingRegister): Promise<void> {
    try {
      await writePendingRegister({
        pending,
        defaults: this.defaults,
        path: this.configPath,
      });
    } catch (err) {
      process.stderr.write(
        `[leash-mcp] warning: failed to persist pending_register: ${
          err instanceof Error ? err.message : 'unknown'
        }\n`,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Result builders
// ────────────────────────────────────────────────────────────────────────────

type RegisterResultLike = LeashToolResult;

function jsonOk(payload: Record<string, unknown>): LeashToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function fundingRequiredResult(args: {
  executive: string;
  network: SvmNetwork;
  balanceLamports: bigint;
  requiredLamports: bigint;
  configPath: string;
  imported: boolean;
}): LeashToolResult {
  const need = args.requiredLamports - args.balanceLamports;
  const networkLabel = args.network === 'solana-mainnet' ? 'mainnet' : 'devnet';
  const faucetHint =
    args.network === 'solana-devnet'
      ? 'Devnet SOL is free — request it via `solana airdrop 1 ' +
        args.executive +
        ' --url https://api.devnet.solana.com` (or any devnet faucet such as faucet.solana.com / quicknode.com/faucet/sol).'
      : 'Mainnet SOL must be sent from a wallet you control. Any wallet works (Phantom / Backpack / a Solana CLI keypair).';
  return jsonOk({
    kind: 'register_agent',
    status: 'funding_required',
    network: args.network,
    executive_pubkey: args.executive,
    balance_lamports: args.balanceLamports.toString(),
    balance_sol: lamportsToSol(args.balanceLamports),
    required_lamports: args.requiredLamports.toString(),
    required_sol: RECOMMENDED_FUND_SOL,
    needed_lamports: (need > 0n ? need : 0n).toString(),
    config_path: args.configPath,
    keypair_source: args.imported ? 'imported' : 'generated',
    instructions: [
      `Send at least ${RECOMMENDED_FUND_SOL} SOL on ${networkLabel} to ${args.executive}.`,
      `Funds rent (~0.005 SOL) for the agent asset + USDC delegation, plus a small buffer for tx fees.`,
      faucetHint,
      `Once funded, call \`leash_register_agent\` again WITH NO ARGUMENTS — the host will resume from the persisted keypair and finish minting.`,
      `The keypair is already saved to ${args.configPath} (chmod 600). Do NOT delete that file before the second call or you'll lose access to the funded executive.`,
    ],
  });
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
function makePlaceholderHost(defaults: LeashHostDefaults): LeashHost {
  const noAgent = (kind: string): LeashToolResult => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          kind,
          status: 'no_agent',
          message:
            'No Leash agent configured. Call `leash_register_agent` to provision one (the tool will walk you through generating or importing an executive keypair, funding it with SOL, and minting on-chain). See https://docs.leash.market/agents/mcp for details.',
        }),
      },
    ],
  });
  return {
    agentMint: null,
    ownerWallet: null,
    network: defaults.network,
    rpcUrl: defaults.rpcUrl,
    apiBaseUrl: defaults.apiBaseUrl,
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
      return fetchDiscover({
        apiBaseUrl: defaults.apiBaseUrl,
        network: defaults.network,
        query: args,
      });
    },
    async reputation(args) {
      return fetchReputation({
        apiBaseUrl: defaults.apiBaseUrl,
        network: defaults.network,
        query: args,
      });
    },
  };
}

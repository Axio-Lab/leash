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
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LEASH_TOOLS, type LeashHost, type LeashTool } from '@leash/mcp-core';

import { loadAgentConfig, type LeashAgentConfig } from './config.js';
import { createStdioHost } from './host-stdio.js';

const SERVER_NAME = 'leash';
const SERVER_VERSION = '0.1.0';

/**
 * Build the MCP server bound to the given host. Each `LeashTool`
 * gets registered via `registerTool()`. The Zod input schema's `.shape`
 * is what `registerTool()` consumes (its inner Zod validation
 * matches what the chat product runs).
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
  // ZodObject exposes `.shape` as the field map; non-ZodObject
  // schemas fall back to the schema itself (legal but unusual).
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
 * the host, build the server. Returns `null` config-side when no
 * agent is provisioned yet — the server is still returned and
 * `tools/list` works, but every tool short-circuits to `no_agent`.
 *
 * Centralised here so the CLI entrypoint and any in-process tests
 * use the exact same boot sequence.
 */
export function buildServerFromEnv(opts?: { configPath?: string }): {
  server: McpServer;
  config: LeashAgentConfig | null;
} {
  const config = loadAgentConfig(opts?.configPath ? { path: opts.configPath } : {});

  if (!config) {
    // Build a host with safe placeholders so the server still
    // initialises. Every tool will return a `no_agent` blob until
    // the user provisions an agent.
    const placeholderHost = makePlaceholderHost();
    return { server: createLeashMcpServer(placeholderHost), config: null };
  }

  return { server: createLeashMcpServer(createStdioHost(config)), config };
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
  // Defer the heavy keypair work to the host; we only need the
  // pubkey for the boot log. Reuse `createStdioHost` and read its
  // ownerWallet so we never decode the secret twice.
  const host = createStdioHost(config);
  return host.ownerWallet ?? '<unknown>';
}

function maskPubkey(pk: string): string {
  if (pk.length < 12) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

/**
 * Stand-in `LeashHost` used when no agent is configured. Every
 * tool route returns a `no_agent` JSON blob via the host method,
 * so the LLM sees a recoverable error and can prompt the user to
 * run onboarding.
 */
function makePlaceholderHost(): LeashHost {
  const noAgent = (kind: string) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          kind,
          status: 'no_agent',
          message:
            'No Leash agent configured. Set LEASH_AGENT_MINT + LEASH_EXECUTIVE_KEY in the environment, or write ~/.config/leash/agent.json. See https://leash.market/docs/mcp/install for details.',
        }),
      },
    ],
  });
  return {
    agentMint: null,
    ownerWallet: null,
    network: 'solana-devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    apiBaseUrl: 'https://api.leash.market',
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
  };
}

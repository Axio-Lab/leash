/**
 * `@leashmarket/mcp` — standalone MCP server for Leash.
 *
 * Public exports
 * --------------
 *   - `runStdioServer()`     : boot the STDIO server (used by `bin/leash-mcp`)
 *   - `buildServerFromEnv()` : build server + parsed config without running
 *   - `createLeashMcpServer()` : low-level builder that takes a `LeashHost`
 *   - `loadAgentConfig()`    : read `~/.config/leash/agent.json` + env
 *   - `loadAgentSession()`   : same, plus optional `pending_register` block
 *   - `loadSigner()`         : decode an executive secret into a `LeashSigner`
 *   - `mintAgentLocally()`   : client-side mint + delegate + record helper
 *
 * Importing this package does NOT auto-run the server. Use the
 * `leash-mcp` binary or call `runStdioServer()` directly.
 */

export { HostRef, buildServerFromEnv, createLeashMcpServer, runStdioServer } from './server.js';

export {
  defaultConfigPath,
  defaultRpcFor,
  loadAgentConfig,
  loadAgentSession,
  type AgentSession,
  type LeashAgentConfig,
  type LeashHostDefaults,
  type PendingRegister,
} from './config.js';

export { writeAgentConfig, writePendingRegister } from './config-write.js';

export { loadSigner, type LeashSigner } from './signer.js';

export { createStdioHost } from './host-stdio.js';

export {
  RECOMMENDED_FUND_LAMPORTS,
  RECOMMENDED_FUND_SOL,
  generateExecutive,
  getExecutiveBalanceLamports,
  importExecutive,
  lamportsToSol,
  mintAgentLocally,
  solToLamports,
  type ExecutiveKeypair,
  type MintLocallyArgs,
  type MintLocallyResult,
} from './mint-local.js';

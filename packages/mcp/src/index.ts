/**
 * `@leash/mcp` — standalone MCP server for Leash.
 *
 * Public exports
 * --------------
 *   - `runStdioServer()`     : boot the STDIO server (used by `bin/leash-mcp`)
 *   - `buildServerFromEnv()` : build server + parsed config without running
 *   - `createLeashMcpServer()` : low-level builder that takes a `LeashHost`
 *   - `loadAgentConfig()`    : read `~/.config/leash/agent.json` + env
 *   - `loadSigner()`         : decode an executive secret into a `LeashSigner`
 *
 * Importing this package does NOT auto-run the server. Use the
 * `leash-mcp` binary or call `runStdioServer()` directly.
 */

export { buildServerFromEnv, createLeashMcpServer, runStdioServer } from './server.js';

export { loadAgentConfig, defaultConfigPath, type LeashAgentConfig } from './config.js';

export { loadSigner, defaultRpcFor, type LeashSigner } from './signer.js';

export { createStdioHost } from './host-stdio.js';

#!/usr/bin/env node
/**
 * `@leash/mcp` STDIO server entry point.
 *
 * Invoked by MCP hosts (Cursor, Claude Desktop, Cline, Continue,
 * ChatGPT-MCP, …) via:
 *
 *   {
 *     "mcpServers": {
 *       "leash": {
 *         "command": "npx",
 *         "args": ["-y", "@leash/mcp"]
 *       }
 *     }
 *   }
 *
 * On boot we load `~/.config/leash/agent.json` (and apply env-var
 * overrides), then connect to the host over STDIO. Logs go to stderr
 * only — STDOUT is reserved for the JSON-RPC framed messages the
 * MCP client reads.
 */

import { runStdioServer } from './server.js';

async function main(): Promise<void> {
  await runStdioServer();
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[leash-mcp] fatal: ${msg}\n`);
  process.exit(1);
});

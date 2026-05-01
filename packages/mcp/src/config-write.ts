/**
 * Persist a freshly-registered agent to `~/.config/leash/agent.json`
 * with `chmod 600` so subsequent `leash-mcp` / `leash` CLI launches
 * pick up the new identity automatically.
 *
 * Lives in its own module (separate from `./config.ts`) because the
 * read path is browser-safe — `loadAgentConfig` only depends on
 * `node:fs` types — while writing requires `node:fs/promises` and
 * `node:os`. Keeping the boundaries clean lets the SDK reuse the
 * read path in non-Node runtimes (Bun, Deno, edge) without dragging
 * in the file-system writer.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { LeashAgentConfig } from './config.js';
import { defaultConfigPath } from './config.js';

/**
 * Write a `LeashAgentConfig` to disk in the JSON shape `loadAgentConfig`
 * expects. Creates parent directories with mode 0700, writes the file
 * with mode 0600. Idempotent: overwrites in-place.
 *
 * Returns the absolute path written so callers can surface it in the
 * tool result for the LLM to quote.
 */
export async function writeAgentConfig(args: {
  config: LeashAgentConfig;
  path?: string;
  /** Pretty-print the JSON for human-friendliness. */
  pretty?: boolean;
}): Promise<string> {
  const path = args.path ?? defaultConfigPath();
  const file = {
    version: 1 as const,
    agent_mint: args.config.agentMint,
    executive_keypair: args.config.executiveSecretBase58,
    network: args.config.network,
    api_url: args.config.apiBaseUrl,
    rpc_url: args.config.rpcUrl,
    ...(args.config.explorerBaseUrl ? { explorer_url: args.config.explorerBaseUrl } : {}),
    ...(args.config.apiKey ? { api_key: args.config.apiKey } : {}),
    created_at: new Date().toISOString(),
  };
  const body = (args.pretty ?? true) ? `${JSON.stringify(file, null, 2)}\n` : JSON.stringify(file);

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, body, { mode: 0o600 });
  return path;
}

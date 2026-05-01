/**
 * Persist a freshly-registered agent (or a pending-register block) to
 * `~/.config/leash/agent.json` with `chmod 600` so subsequent
 * `leash-mcp` / `leash` CLI launches pick up the new identity
 * automatically.
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

import type { LeashAgentConfig, LeashHostDefaults, PendingRegister } from './config.js';
import { defaultConfigPath } from './config.js';

/**
 * Write a fully-registered `LeashAgentConfig` to disk. Creates parent
 * directories with mode 0700, writes the file with mode 0600.
 * Idempotent: overwrites in-place. Clears any `pending_register`
 * block left over from the two-step registration flow.
 */
export async function writeAgentConfig(args: {
  config: LeashAgentConfig;
  path?: string;
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
  return writeJson(path, file, args.pretty ?? true);
}

/**
 * Persist a pending executive keypair while the user funds it with
 * SOL. Subsequent `leash_register_agent` calls (or a fresh MCP boot)
 * will pick this up via `loadAgentSession().pending`. The block is
 * cleared once `writeAgentConfig` lands the registered config.
 */
export async function writePendingRegister(args: {
  pending: PendingRegister;
  defaults: LeashHostDefaults;
  path?: string;
  pretty?: boolean;
}): Promise<string> {
  const path = args.path ?? defaultConfigPath();
  const meta = args.pending.meta;
  const metaJson =
    meta &&
    (meta.name || meta.description || meta.imageUrl || (meta.services && meta.services.length > 0))
      ? {
          ...(meta.name ? { name: meta.name } : {}),
          ...(meta.description ? { description: meta.description } : {}),
          ...(meta.imageUrl ? { image_url: meta.imageUrl } : {}),
          ...(meta.services && meta.services.length > 0 ? { services: meta.services } : {}),
        }
      : null;
  const file = {
    version: 1 as const,
    network: args.defaults.network,
    api_url: args.defaults.apiBaseUrl,
    rpc_url: args.defaults.rpcUrl,
    ...(args.defaults.explorerBaseUrl ? { explorer_url: args.defaults.explorerBaseUrl } : {}),
    ...(args.defaults.apiKey ? { api_key: args.defaults.apiKey } : {}),
    pending_register: {
      executive_keypair: args.pending.executiveSecretBase58,
      executive_pubkey: args.pending.executivePubkey,
      network: args.pending.network,
      created_at: args.pending.createdAt,
      ...(metaJson ? { meta: metaJson } : {}),
    },
    created_at: new Date().toISOString(),
  };
  return writeJson(path, file, args.pretty ?? true);
}

async function writeJson(path: string, payload: unknown, pretty: boolean): Promise<string> {
  const body = pretty ? `${JSON.stringify(payload, null, 2)}\n` : JSON.stringify(payload);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, body, { mode: 0o600 });
  return path;
}

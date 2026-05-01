/**
 * Local agent configuration for the standalone Leash MCP server.
 *
 * Source of truth is `~/.config/leash/agent.json` (chmod 600). Same
 * posture as `gcloud`, `gh`, `aws`. Each field can be overridden via
 * an environment variable, which makes the MCP CI/CD-friendly without
 * needing a config file at all:
 *
 *   - LEASH_AGENT_MINT          → agent_mint
 *   - LEASH_EXECUTIVE_KEY       → executive_keypair (base58 OR JSON array)
 *   - LEASH_NETWORK             → network ('solana-mainnet' | 'solana-devnet'). Defaults to `solana-mainnet`.
 *   - LEASH_API_URL             → apiBaseUrl
 *   - LEASH_RPC_URL             → rpcUrl override (otherwise picked per network)
 *   - LEASH_EXPLORER_URL        → explorerBaseUrl (default explorer.leash.market)
 *   - LEASH_API_KEY             → bearer token for legacy API-key endpoints
 *                                 (X-Leash-Sig auth is the long-term path)
 *
 * Loading rules:
 *   1. Read `agent.json` if it exists.
 *   2. Apply env-var overrides on top.
 *   3. The host always boots — `loadAgentSession` returns a `defaults`
 *      block (network/rpc/api/explorer) even when no agent is
 *      provisioned, so `leash_register_agent` can run before the file
 *      exists. `config` is `null` until a mint is recorded; `pending`
 *      is set when the user has chosen a keypair but not yet funded
 *      it (the gap between the two `leash_register_agent` calls).
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { SvmNetwork } from '@leash/mcp-core';

/** Always-available host defaults. Resolvable without any agent state. */
export type LeashHostDefaults = {
  network: SvmNetwork;
  apiBaseUrl: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  apiKey: string | null;
};

/**
 * Persisted-but-unfunded executive keypair. Written to `agent.json` on
 * the FIRST `leash_register_agent` call; consumed (and cleared) on the
 * SECOND call after the user has funded the executive with SOL.
 */
export type PendingRegister = {
  /** 64-byte ed25519 secret, base58. */
  executiveSecretBase58: string;
  /** Cached pubkey so doctor / status checks don't need to re-derive. */
  executivePubkey: string;
  network: SvmNetwork;
  createdAt: string;
};

export type LeashAgentConfig = {
  agentMint: string;
  /** Raw base58 secret (length 64-byte ed25519 keypair). */
  executiveSecretBase58: string;
  network: SvmNetwork;
  /** Base URL of the Leash API the host should talk to. */
  apiBaseUrl: string;
  /** Solana RPC URL used for direct chain reads + tx submission. */
  rpcUrl: string;
  /**
   * Base URL of the Leash protocol explorer used to build
   * `receipt_url` / `agent_url` deep-links. Defaults to
   * `https://explorer.leash.market`.
   */
  explorerBaseUrl: string;
  /** Optional legacy API-key bearer token. Goes away once X-Leash-Sig auth is in. */
  apiKey: string | null;
};

/** Snapshot returned by {@link loadAgentSession}. */
export type AgentSession = {
  config: LeashAgentConfig | null;
  pending: PendingRegister | null;
  defaults: LeashHostDefaults;
};

const DEFAULT_API_URL = 'https://api.leash.market';
const DEFAULT_EXPLORER_URL = 'https://explorer.leash.market';
/**
 * Public Solana RPC fallbacks. Used only when `LEASH_RPC_URL` and
 * `agent.json:rpc_url` are both unset.
 *
 * **These are slow.** They are public, heavily rate-limited
 * (429s under load), and add 4-8s of latency to every
 * `leash_pay_payment_link` call (each settlement makes 3-5 RPC
 * round-trips). Production users should set `LEASH_RPC_URL` (or
 * persist `rpc_url` in `~/.config/leash/agent.json`) to a Helius /
 * Triton / QuickNode / Alchemy / self-hosted endpoint — settlement
 * latency drops to sub-second and 429s disappear.
 *
 * The MCP and CLI docs surface this in a "Bring your own RPC"
 * callout; keep this comment in sync if those move.
 */
const DEFAULT_RPC: Record<SvmNetwork, string> = {
  'solana-devnet': 'https://api.devnet.solana.com',
  'solana-mainnet': 'https://api.mainnet-beta.solana.com',
};

export function defaultRpcFor(network: SvmNetwork): string {
  return DEFAULT_RPC[network];
}

/** Path searched for the on-disk config. Exposed for tests. */
export function defaultConfigPath(): string {
  return join(homedir(), '.config', 'leash', 'agent.json');
}

type FilePending = {
  executive_keypair?: string;
  executive_pubkey?: string;
  network?: string;
  created_at?: string;
};

type FileShape = {
  version?: number;
  agent_mint?: string;
  executive_keypair?: string;
  network?: string;
  api_url?: string;
  rpc_url?: string;
  explorer_url?: string;
  api_key?: string;
  created_at?: string;
  pending_register?: FilePending;
};

/**
 * Best-effort read of the on-disk config. Missing or malformed files
 * yield `null`; we never throw because the MCP must boot regardless
 * (so `tools/list` works and the LLM can call onboarding tools).
 */
function tryReadFile(path: string): FileShape | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as FileShape;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function pick(envVal: string | undefined, fileVal: string | undefined): string | undefined {
  const e = envVal?.trim();
  if (e && e.length > 0) return e;
  const f = fileVal?.trim();
  if (f && f.length > 0) return f;
  return undefined;
}

function normalizeNetwork(raw: string | undefined): SvmNetwork {
  const lower = raw?.toLowerCase().trim();
  if (lower === 'solana-devnet' || lower === 'devnet') return 'solana-devnet';
  return 'solana-mainnet';
}

function resolveDefaults(file: FileShape | null): LeashHostDefaults {
  const network = normalizeNetwork(process.env.LEASH_NETWORK ?? file?.network);
  const apiBaseUrl = pick(process.env.LEASH_API_URL, file?.api_url) ?? DEFAULT_API_URL;
  const rpcUrl = pick(process.env.LEASH_RPC_URL, file?.rpc_url) ?? DEFAULT_RPC[network];
  const explorerBaseUrl =
    pick(process.env.LEASH_EXPLORER_URL, file?.explorer_url) ?? DEFAULT_EXPLORER_URL;
  const apiKey = pick(process.env.LEASH_API_KEY, file?.api_key) ?? null;
  return { network, apiBaseUrl, rpcUrl, explorerBaseUrl, apiKey };
}

function readPending(file: FileShape | null, defaults: LeashHostDefaults): PendingRegister | null {
  const block = file?.pending_register;
  if (!block) return null;
  const secret = block.executive_keypair?.trim();
  const pub = block.executive_pubkey?.trim();
  if (!secret || !pub) return null;
  return {
    executiveSecretBase58: secret,
    executivePubkey: pub,
    network: normalizeNetwork(block.network ?? defaults.network),
    createdAt: block.created_at ?? new Date(0).toISOString(),
  };
}

/**
 * Resolve the host's full session snapshot. Always returns `defaults`
 * (so the host can boot and `leash_register_agent` is callable);
 * `config` and `pending` are present only when previously persisted.
 */
export function loadAgentSession(opts?: { path?: string }): AgentSession {
  const path = opts?.path ?? defaultConfigPath();
  const file = tryReadFile(path);
  const defaults = resolveDefaults(file);

  const agentMint = pick(process.env.LEASH_AGENT_MINT, file?.agent_mint);
  const executiveSecret = pick(process.env.LEASH_EXECUTIVE_KEY, file?.executive_keypair);
  const config: LeashAgentConfig | null =
    agentMint && executiveSecret
      ? {
          agentMint,
          executiveSecretBase58: executiveSecret,
          network: defaults.network,
          apiBaseUrl: defaults.apiBaseUrl,
          rpcUrl: defaults.rpcUrl,
          explorerBaseUrl: defaults.explorerBaseUrl,
          apiKey: defaults.apiKey,
        }
      : null;
  const pending = readPending(file, defaults);
  return { config, pending, defaults };
}

/**
 * Backwards-compat shim — same return as the v0.1 build (config-only,
 * `null` when no mint persisted). Used by the test suite and any
 * external callers that imported it.
 */
export function loadAgentConfig(opts?: { path?: string }): LeashAgentConfig | null {
  return loadAgentSession(opts).config;
}

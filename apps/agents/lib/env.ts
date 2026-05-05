/**
 * Centralised env access for `apps/agents`.
 *
 * The Privy *public* app id is the only secret that's safe to ship to
 * the browser; the *secret* is read in server contexts only (route
 * handlers, server components).
 */

export const NEXT_PUBLIC_PRIVY_APP_ID: string = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

/** Explicit RPC endpoint for devnet surfaces. */
export const SOLANA_RPC_DEVNET: string =
  process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET?.trim() || 'https://api.devnet.solana.com';

/** Explicit RPC endpoint for mainnet surfaces. */
export const SOLANA_RPC_MAINNET: string =
  process.env.NEXT_PUBLIC_SOLANA_RPC_MAINNET?.trim() || 'https://api.mainnet-beta.solana.com';

export type SolanaNetwork = 'solana-mainnet' | 'solana-devnet';

export function resolveNetwork(): SolanaNetwork {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim();
  if (explicit === 'solana-mainnet' || explicit === 'solana-devnet') return explicit;
  return SOLANA_RPC_DEVNET.includes('devnet') ||
    SOLANA_RPC_DEVNET.includes('localhost') ||
    SOLANA_RPC_DEVNET.includes('127.0.0.1')
    ? 'solana-devnet'
    : 'solana-mainnet';
}

export const SOLANA_NETWORK: SolanaNetwork = resolveNetwork();

/** Active RPC endpoint selected from SOLANA_NETWORK. */
export const SOLANA_RPC: string =
  SOLANA_NETWORK === 'solana-mainnet' ? SOLANA_RPC_MAINNET : SOLANA_RPC_DEVNET;

/**
 * Per-user model "tier". The platform exposes three Claude tiers in
 * Profile → LLM; each tier resolves to a concrete Anthropic model id
 * via the env vars below. Operators can roll/upgrade model ids without
 * a code change.
 */
export type AgentModelTier = 'haiku' | 'sonnet' | 'opus';

export const AGENT_MODEL_TIERS: readonly AgentModelTier[] = ['haiku', 'sonnet', 'opus'] as const;

export const DEFAULT_AGENT_MODEL_TIER: AgentModelTier = 'sonnet';

const HAIKU_MODEL_FALLBACK = 'claude-haiku-4-5';
const SONNET_MODEL_FALLBACK = 'claude-sonnet-4-5';
const OPUS_MODEL_FALLBACK = 'claude-opus-4-5';

/**
 * Resolve a tier (`haiku` | `sonnet` | `opus`) to a concrete Anthropic
 * model id. Lookup order:
 *
 *   1. `LEASH_AGENT_MODEL` — hard override; pins every chat regardless
 *      of the user's tier. Use for tests / staging snapshots.
 *   2. `LEASH_AGENT_MODEL_{HAIKU|SONNET|OPUS}` — per-tier id.
 *   3. Conservative built-in fallback shipped with this build.
 */
export function resolveAgentModel(tier: AgentModelTier): string {
  const override = process.env.LEASH_AGENT_MODEL?.trim();
  if (override) return override;
  switch (tier) {
    case 'haiku':
      return process.env.LEASH_AGENT_MODEL_HAIKU?.trim() || HAIKU_MODEL_FALLBACK;
    case 'opus':
      return process.env.LEASH_AGENT_MODEL_OPUS?.trim() || OPUS_MODEL_FALLBACK;
    case 'sonnet':
    default:
      return process.env.LEASH_AGENT_MODEL_SONNET?.trim() || SONNET_MODEL_FALLBACK;
  }
}

/**
 * Back-compat default. Equivalent to `resolveAgentModel('sonnet')`.
 * Used by code paths that don't (yet) carry a user/tier — e.g. the
 * agent-mint payload which stamps a model on the on-chain record.
 */
export const LEASH_AGENT_MODEL: string = resolveAgentModel(DEFAULT_AGENT_MODEL_TIER);

/** Explorer base URL (public). */
export const NEXT_PUBLIC_EXPLORER_URL: string =
  process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/+$/, '') ?? 'https://explorer.leash.market';

/**
 * Server-only env. These fields are read inside route handlers; the
 * accessor throws to fail loudly in deployment when a secret is missing
 * (rather than silently 401-ing every request).
 */
export type ServerEnv = {
  privyAppId: string;
  privyAppSecret: string;
  leashApiUrl: string;
  leashApiAdminSecret: string;
  leashDbUrl: string;
  leashDbAuthToken: string | undefined;
  encryptionKey: string;
  /** Platform Anthropic key — optional until chat brain is used. */
  anthropicApiKey: string | undefined;
  composioApiKey: string | undefined;
  leashAgentModel: string;
  /**
   * Shared secret the apps/api Telegram dispatcher (and any other
   * server-to-server caller) uses to invoke the run-on-behalf BFF
   * endpoint at `POST /api/agents/run`. Required when external chat
   * bridges are enabled; an empty value disables the endpoint.
   */
  agentsAdminSecret: string | undefined;
};

export function getServerEnv(): ServerEnv {
  const get = (name: string): string => {
    const v = process.env[name];
    if (!v || v.length === 0) {
      throw new Error(`missing required env var: ${name}`);
    }
    return v;
  };
  const optional = (name: string): string | undefined => {
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
  };
  return {
    privyAppId: get('PRIVY_APP_ID'),
    privyAppSecret: get('PRIVY_APP_SECRET'),
    leashApiUrl: get('LEASH_API_URL').replace(/\/+$/, ''),
    leashApiAdminSecret: get('LEASH_API_ADMIN_SECRET'),
    leashDbUrl: get('LEASH_DB_URL'),
    leashDbAuthToken: process.env.LEASH_DB_AUTH_TOKEN,
    encryptionKey: get('ENCRYPTION_KEY'),
    anthropicApiKey: optional('ANTHROPIC_API_KEY'),
    composioApiKey: optional('COMPOSIO_API_KEY'),
    leashAgentModel: optional('LEASH_AGENT_MODEL') ?? LEASH_AGENT_MODEL,
    agentsAdminSecret: optional('LEASH_AGENTS_ADMIN_SECRET'),
  };
}

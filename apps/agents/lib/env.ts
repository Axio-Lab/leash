/**
 * Centralised env access for `apps/agents`.
 *
 * The Privy *public* app id is the only secret that's safe to ship to
 * the browser; the *secret* is read in server contexts only (route
 * handlers, server components).
 */

export const NEXT_PUBLIC_PRIVY_APP_ID: string = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

export const SOLANA_RPC: string =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com';

export type SolanaNetwork = 'solana-mainnet' | 'solana-devnet';

export function resolveNetwork(): SolanaNetwork {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim();
  if (explicit === 'solana-mainnet' || explicit === 'solana-devnet') return explicit;
  return SOLANA_RPC.includes('devnet') ||
    SOLANA_RPC.includes('localhost') ||
    SOLANA_RPC.includes('127.0.0.1')
    ? 'solana-devnet'
    : 'solana-mainnet';
}

export const SOLANA_NETWORK: SolanaNetwork = resolveNetwork();

/** Default Claude model for agent turns (override via LEASH_AGENT_MODEL). */
export const LEASH_AGENT_MODEL: string =
  process.env.LEASH_AGENT_MODEL?.trim() || 'claude-sonnet-4-20250514';

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
  };
}

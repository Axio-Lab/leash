export const NEXT_PUBLIC_PRIVY_APP_ID: string = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

export const NEXT_PUBLIC_AGENTS_URL: string =
  process.env.NEXT_PUBLIC_AGENTS_URL ?? 'http://localhost:4100';

/** Hosted agent product (footer “Agent platform”). */
export const NEXT_PUBLIC_AGENT_PLATFORM_URL: string =
  process.env.NEXT_PUBLIC_AGENT_PLATFORM_URL ?? 'https://agent.leash.market';

/** Public docs site (`docs.leash.market` in prod). */
export const NEXT_PUBLIC_DOCS_URL: string =
  process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.leash.market';

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

export type ServerEnv = {
  privyAppId: string;
  privyAppSecret: string;
  leashApiUrl: string;
  leashApiAdminSecret: string;
  leashDbUrl: string;
  leashDbAuthToken: string | undefined;
  adminPrivyIds: string[];
};

export function getServerEnv(): ServerEnv {
  const get = (n: string): string => {
    const v = process.env[n];
    if (!v || v.length === 0) throw new Error(`missing env: ${n}`);
    return v;
  };
  const admins = (process.env.LEASH_ADMIN_PRIVY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const privyAppId = get('PRIVY_APP_ID');
  const nextPublicPrivy = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (nextPublicPrivy && nextPublicPrivy !== privyAppId) {
    throw new Error(
      'PRIVY_APP_ID must equal NEXT_PUBLIC_PRIVY_APP_ID (same Privy app). A mismatch makes every /api/* BFF call return 401.',
    );
  }
  return {
    privyAppId,
    privyAppSecret: get('PRIVY_APP_SECRET'),
    leashApiUrl: get('LEASH_API_URL').replace(/\/+$/, ''),
    leashApiAdminSecret: get('LEASH_API_ADMIN_SECRET'),
    leashDbUrl: get('LEASH_DB_URL'),
    leashDbAuthToken: process.env.LEASH_DB_AUTH_TOKEN,
    adminPrivyIds: admins,
  };
}

export function isAdminPrivyId(privyId: string): boolean {
  const ids = (process.env.LEASH_ADMIN_PRIVY_IDS ?? '').split(',').map((s) => s.trim());
  return ids.includes(privyId);
}

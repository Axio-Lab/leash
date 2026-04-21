/**
 * Centralized env reads. Defaults match `docker-compose.yml`. The browser only
 * sees variables prefixed with `NEXT_PUBLIC_*`.
 */

export const RUNNER_URL: string = process.env.LEASH_RUNNER_URL ?? 'http://localhost:8787';
export const SELLER_URL: string = process.env.LEASH_SELLER_URL ?? 'http://localhost:3001';
export const SOLANA_RPC: string =
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  process.env.SOLANA_RPC ??
  'https://api.devnet.solana.com';

export const PRIVY_APP_ID: string = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
export function getPrivyClientId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();
  if (!raw) return undefined;
  if (raw.startsWith('privy_app_secret_')) return undefined;
  return raw;
}

/**
 * Centralized env reads. Defaults match `docker-compose.yml`. The browser only
 * sees variables prefixed with `NEXT_PUBLIC_*`.
 */

import { FALLBACK_FACILITATOR_URL, networkFromRpc } from '@leashmarket/core';

/**
 * x402 facilitator base URL (no trailing slash). Used by `createBuyer` /
 * `createSeller` in the playground.
 *
 * - **Browser (`'use client'`)** — only `NEXT_PUBLIC_LEASH_FACILITATOR_URL`
 *   is inlined at build time.
 * - **Server routes** — may also read `LEASH_FACILITATOR_URL` (no prefix) so
 *   docker / CI can set one var for SSR only.
 *
 * Default: public hosted facilitator (`https://facilitator.svmacc.tech`).
 */
function resolveFacilitatorUrl(): string {
  const fromPublic = process.env.NEXT_PUBLIC_LEASH_FACILITATOR_URL?.trim();
  if (fromPublic) return fromPublic.replace(/\/+$/, '');
  const fromServer = process.env.LEASH_FACILITATOR_URL?.trim();
  if (fromServer) return fromServer.replace(/\/+$/, '');
  return FALLBACK_FACILITATOR_URL;
}

export const FACILITATOR_URL: string = resolveFacilitatorUrl();

/** Short label for UI badges (hostname or raw string). */
export function facilitatorDisplayHost(): string {
  try {
    return new URL(FACILITATOR_URL).host;
  } catch {
    return FACILITATOR_URL;
  }
}

export const RUNNER_URL: string = process.env.LEASH_RUNNER_URL ?? 'http://localhost:8787';
export const SELLER_URL: string = process.env.LEASH_SELLER_URL ?? 'http://localhost:3001';
export const SOLANA_RPC: string =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';

/**
 * The Solana cluster the playground points at. Resolved in this order:
 *
 *   1. `NEXT_PUBLIC_SOLANA_NETWORK` if set to `solana-mainnet` or
 *      `solana-devnet` — explicit override for the rare case where the RPC
 *      hostname doesn't match the cluster (e.g. a private mainnet relay
 *      that doesn't include "mainnet" in the URL).
 *   2. Otherwise heuristically derived from {@link SOLANA_RPC} via
 *      {@link networkFromRpc} (treats anything with `devnet`, `localhost`,
 *      or `127.0.0.1` as devnet).
 *
 * This is the single source of truth used by the buyer playground
 * (`createBuyer({ networks: [SOLANA_NETWORK] })`), the seller payment-link
 * builder, and any UI badge that needs to render the active cluster. To
 * switch the whole app to mainnet, set:
 *
 *   NEXT_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com
 *   # NEXT_PUBLIC_SOLANA_NETWORK=solana-mainnet  ← only needed if RPC is opaque
 */
export type SolanaNetwork = 'solana-mainnet' | 'solana-devnet';

function resolveNetwork(): SolanaNetwork {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim();
  if (explicit === 'solana-mainnet' || explicit === 'solana-devnet') return explicit;
  return networkFromRpc(SOLANA_RPC) === 'mainnet' ? 'solana-mainnet' : 'solana-devnet';
}

export const SOLANA_NETWORK: SolanaNetwork = resolveNetwork();

/**
 * Short cluster bucket (`'mainnet' | 'devnet'`) — convenient for explorer
 * URL builders and any helper that prefers the short form. Always derived
 * from {@link SOLANA_NETWORK} so the two stay in lock-step.
 */
export const SOLANA_CLUSTER: 'mainnet' | 'devnet' =
  SOLANA_NETWORK === 'solana-mainnet' ? 'mainnet' : 'devnet';

export const PRIVY_APP_ID: string = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
export function getPrivyClientId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();
  if (!raw) return undefined;
  if (raw.startsWith('privy_app_secret_')) return undefined;
  return raw;
}

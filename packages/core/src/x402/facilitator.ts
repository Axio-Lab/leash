/**
 * Default x402 facilitator URLs for the networks Leash currently supports.
 *
 * The buyer never talks to the facilitator directly (the seller does), but
 * we record the URL on every receipt so explorers can independently
 * re-verify settlement. Centralising the defaults here keeps buyer-kit and
 * seller-kit honest — they both fall back to the same value, and an
 * environment-level override (`LEASH_FACILITATOR_URL`) flows through the
 * stack uniformly.
 *
 * Defaults (as of April 2026):
 *
 *   - **Solana devnet** → `https://facilitator-devnet.leash.market`
 *     Leash-operated `@leashmarket/facilitator` instance. Gas-sponsored, supports
 *     the `exact` SVM scheme (x402 v1 + v2), Token-2022, and the Leash
 *     1% protocol fee leg. The facilitator auto-provisions destination ATAs
 *     (seller payTo + fee vault) so first-time USDG/USDT settlements work
 *     without manual ATA setup.
 *
 *   - **Solana mainnet** → `https://facilitator.leash.market`
 *     Leash-operated mainnet instance. Same wire contract as devnet.
 *
 * To override: set `LEASH_FACILITATOR_URL` in the buyer/seller process, or
 * pass `facilitator: '…'` directly to `createBuyer` / `createSeller`.
 */

import type { LeashX402Network } from './client.js';

export const DEFAULT_FACILITATORS: Partial<Record<LeashX402Network, string>> = {
  'solana-devnet': 'https://facilitator-devnet.leash.market',
  'solana-mainnet': 'https://facilitator.leash.market',
};

/** Canonical Leash devnet facilitator URL. */
export const LEASH_FACILITATOR_URL = 'https://facilitator-devnet.leash.market';

/** Universal fallback when nothing else resolves. */
export const FALLBACK_FACILITATOR_URL = 'https://facilitator-devnet.leash.market';

/**
 * Resolve the facilitator URL Leash should default to.
 *
 * Resolution order:
 *
 *   1. `process.env.LEASH_FACILITATOR_URL` if set (works everywhere `process`
 *      exists; safely no-ops in browser bundles where `process` is shimmed
 *      out by Webpack/Next).
 *   2. The first network's hosted default in {@link DEFAULT_FACILITATORS}.
 *   3. {@link FALLBACK_FACILITATOR_URL} — keeps the API total
 *      so callers never have to handle "no default".
 */
export function defaultFacilitatorFor(
  networks: ReadonlyArray<LeashX402Network> | LeashX402Network | undefined,
): string {
  const envOverride =
    typeof process !== 'undefined' && process.env?.LEASH_FACILITATOR_URL
      ? process.env.LEASH_FACILITATOR_URL
      : null;
  if (envOverride) return envOverride;
  const arr: ReadonlyArray<LeashX402Network> =
    networks == null ? [] : Array.isArray(networks) ? networks : [networks as LeashX402Network];
  const first = arr[0];
  if (first) {
    const url = DEFAULT_FACILITATORS[first];
    if (url) return url;
  }
  return FALLBACK_FACILITATOR_URL;
}

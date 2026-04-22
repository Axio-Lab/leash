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
 * Picks (April 2026):
 *
 *   - **Solana devnet** → `https://facilitator.svmacc.tech` — free,
 *     gas-sponsored, supports the `exact` scheme and Token-2022, run by the
 *     SVMacc team. Battle-tested under the playground's load.
 *   - **Solana mainnet** → `https://facilitator.payai.network` — gas-
 *     sponsored mainnet exact-scheme facilitator run by PayAI. Drop in your
 *     own URL if you want to self-host.
 *
 * Coming soon:
 *
 *   - **Leash devnet facilitator** → `https://facilitator.leash.dev` —
 *     `@leash/facilitator` running x402's `exact` SVM scheme (v1 + v2)
 *     against Solana devnet. Operationally equivalent to svmacc but
 *     under our control, so we can tie settlements back to receipts in
 *     the explorer (Order #6 from the roadmap). Opt in by exporting
 *     `LEASH_FACILITATOR_URL=https://facilitator.leash.dev` until we
 *     promote it to the default in {@link DEFAULT_FACILITATORS}.
 *
 * To override: set `LEASH_FACILITATOR_URL` in the buyer/seller process, or
 * pass `facilitator: '…'` directly to `createBuyer` / `createSeller`.
 */

import type { LeashX402Network } from './client.js';

export const DEFAULT_FACILITATORS: Partial<Record<LeashX402Network, string>> = {
  'solana-devnet': 'https://facilitator.svmacc.tech',
  'solana-mainnet': 'https://facilitator.payai.network',
};

/**
 * Public URL of the Leash-operated facilitator. **Devnet only** in v0.1.
 *
 * Not yet wired into {@link DEFAULT_FACILITATORS} — once the host is
 * stable and we've topped up the fee-payer wallet, devnet will switch
 * over here. Exposed today so demos and docs can reference it as an
 * opt-in via `LEASH_FACILITATOR_URL=…`.
 */
export const LEASH_FACILITATOR_URL = 'https://facilitator.leash.dev';

/** Universal fallback when nothing else resolves. */
export const FALLBACK_FACILITATOR_URL = 'https://facilitator.svmacc.tech';

/**
 * Resolve the facilitator URL Leash should default to.
 *
 * Resolution order:
 *
 *   1. `process.env.LEASH_FACILITATOR_URL` if set (works everywhere `process`
 *      exists; safely no-ops in browser bundles where `process` is shimmed
 *      out by Webpack/Next).
 *   2. The first network's hosted default in {@link DEFAULT_FACILITATORS}.
 *   3. {@link FALLBACK_FACILITATOR_URL} (svmacc devnet) — keeps the API total
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

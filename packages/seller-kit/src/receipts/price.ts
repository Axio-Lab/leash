import type { ReceiptV1 } from '@leash/schemas';

type Price = NonNullable<ReceiptV1['price']>;

/**
 * Parse the human-readable `price` strings used in `SellerRouteConfig`
 * (e.g. `"$0.001"`, `"0.01 USDC"`, `"0.5"`) into the structured
 * `{ amount, currency }` shape stored inside `ReceiptV1.price`.
 *
 * Rules:
 * - A leading `$` (or `USD`) is treated as USDC for receipt purposes.
 *   v0.1 only settles in USDC on the SVM side, so we normalise to that.
 * - A trailing token symbol (`USDC`, `USDT`, etc.) is preserved as-is.
 * - A bare number defaults to USDC.
 * - Empty / unparseable input returns `null` so callers can decide whether
 *   to emit a price-less receipt or to treat it as a misconfiguration.
 */
export function parsePrice(input: string): Price | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // "$0.001" → 0.001 USDC
  const dollar = trimmed.match(/^\$\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (dollar) {
    return { amount: dollar[1], currency: 'USDC' };
  }

  // "0.01 USDC" or "0.01USDC"
  const suffixed = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Z][A-Z0-9]{1,9})$/i);
  if (suffixed) {
    const currency = suffixed[2].toUpperCase();
    return { amount: suffixed[1], currency: currency === 'USD' ? 'USDC' : currency };
  }

  // Bare number "0.001"
  const bare = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (bare) {
    return { amount: bare[1], currency: 'USDC' };
  }

  return null;
}

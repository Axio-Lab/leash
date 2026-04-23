import type { ReceiptV1 } from '@leash/schemas';
import {
  decimalToAtomic,
  KNOWN_STABLE_SYMBOLS,
  lookupTokenBySymbol,
  type KnownStableSymbol,
  type TokenNetwork,
} from '@leash/core';

type Price = NonNullable<ReceiptV1['price']>;

/**
 * Parse a human-readable `price` string used in `SellerRouteConfig`
 * (e.g. `"$0.001"`, `"0.01 USDG"`, `"0.5"`) into the structured
 * `{ amount, currency, asset? }` shape stored inside `ReceiptV1.price`.
 *
 * `amount` is returned as the **atomic integer** for the resolved currency
 * on the supplied `network` (e.g. `"$0.001"` → `"1000"` for USDC's 6
 * decimals). This keeps every receipt — earn or spend — using the same
 * on-the-wire representation, so format helpers in `@leash/core/format`
 * never have to guess whether a string is decimal or atomic.
 *
 * Resolution rules:
 * - A leading `$` (or trailing `USD`) is treated as the supplied
 *   `defaultCurrency` (defaults to `'USDC'`). v0.1 settles only in known
 *   stablecoins on Solana, so dollars map cleanly onto a 6-dec stable.
 * - A trailing token symbol (`USDC`, `USDT`, `USDG`) is preserved.
 * - A bare number falls back to `defaultCurrency`.
 * - Unknown stables (or non-stables in v0.1) return `null` so callers can
 *   fail loudly instead of stamping a wrong asset onto the receipt.
 */
export function parsePrice(
  input: string,
  opts: { network?: TokenNetwork; defaultCurrency?: KnownStableSymbol } = {},
): Price | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const network: TokenNetwork = opts.network ?? 'devnet';
  const defaultCurrency: KnownStableSymbol = opts.defaultCurrency ?? 'USDC';

  const dollar = trimmed.match(/^\$\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (dollar) {
    return finalize(dollar[1], defaultCurrency, network);
  }

  const suffixed = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Z][A-Z0-9]{1,9})$/i);
  if (suffixed) {
    const sym = suffixed[2].toUpperCase();
    const currency = sym === 'USD' ? defaultCurrency : sym;
    if (!isKnownStable(currency)) return null;
    return finalize(suffixed[1], currency, network);
  }

  const bare = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (bare) {
    return finalize(bare[1], defaultCurrency, network);
  }

  return null;
}

function finalize(
  decimal: string,
  currency: KnownStableSymbol,
  network: TokenNetwork,
): Price | null {
  const token = lookupTokenBySymbol(currency, network);
  if (!token) return null;
  const atomic = decimalToAtomic(decimal, token.decimals);
  if (atomic === null) return null;
  return { amount: atomic.toString(), currency, asset: token.mint };
}

function isKnownStable(symbol: string): symbol is KnownStableSymbol {
  return (KNOWN_STABLE_SYMBOLS as ReadonlyArray<string>).includes(symbol);
}

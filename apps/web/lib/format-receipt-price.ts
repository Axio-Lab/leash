import type { ReceiptV1 } from '@leash/schemas';

/**
 * Format `ReceiptV1.price` for UI. x402 / buyer-kit persist USDC as an
 * integer string in **atomic** units (6 decimals). Legacy rows may already
 * use a decimal string — those pass through unchanged.
 */
export function formatReceiptPrice(price: ReceiptV1['price'] | undefined | null): string | null {
  if (!price) return null;
  const { amount, currency } = price;

  if (currency === 'USDC' && /^\d+$/.test(amount)) {
    const decimals = 6;
    const padded = amount.padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals);
    const frac = padded.slice(-decimals).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
  }

  return amount;
}

/** Same as {@link formatReceiptPrice} but appends the currency ticker. */
export function formatReceiptPriceWithCurrency(
  price: ReceiptV1['price'] | undefined | null,
): string | null {
  if (!price) return null;
  const core = formatReceiptPrice(price);
  if (core === null) return null;
  return `${core} ${price.currency}`;
}

/**
 * USD-style display ("$1.23", "$0.001000") for stablecoin prices. Falls back
 * to {@link formatReceiptPriceWithCurrency} for non-stable currencies. Handy
 * for receipt feeds where the dollar peg makes the value scannable at a
 * glance and avoids the trailing "USDC" noise.
 */
export function formatReceiptPriceUsd(price: ReceiptV1['price'] | undefined | null): string | null {
  if (!price) return null;
  const STABLES = new Set(['USDC', 'USDT', 'USDG', 'PYUSD']);
  if (!STABLES.has(price.currency)) return formatReceiptPriceWithCurrency(price);
  const core = formatReceiptPrice(price);
  if (core === null) return null;
  // For "1" / "1.5" pad to two decimals so $1 doesn't look truncated;
  // for "0.000002" preserve the long tail.
  if (/^\d+$/.test(core)) return `$${core}.00`;
  const [whole, frac = ''] = core.split('.');
  if (frac.length < 2) return `$${whole}.${frac.padEnd(2, '0')}`;
  return `$${core}`;
}

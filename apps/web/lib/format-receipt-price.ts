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

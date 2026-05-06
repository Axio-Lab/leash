/**
 * Token-aware amount formatting / parsing helpers shared by every Leash UI
 * surface (web playground, CLI demos) and downstream consumers.
 *
 * The fundamental invariant: **on the wire, amounts are integer strings in
 * the token's atomic unit** (e.g. 1 USDC = `"1000000"` because USDC has 6
 * decimals). Decimal display ("1.50 USDC") is a UI concern only and must
 * be derived from the mint's `decimals`. Hand-rolling `*1_000_000` math
 * silently breaks for Token-2022 stables with different decimal counts;
 * always pass the right `decimals` here.
 */

import type { ReceiptV1 } from '@leashmarket/schemas';
import { lookupToken, type TokenNetwork } from '../tokens/index.js';

/** USD-pegged stablecoin tickers shown with `$` prefix in {@link formatAmountUsd}. */
const STABLES: ReadonlySet<string> = new Set(['USDC', 'USDT', 'USDG', 'PYUSD']);

/**
 * Convert an atomic integer string (or bigint) to its decimal string form.
 *
 * @example
 * atomicToDecimal('1000000', 6) // '1'
 * atomicToDecimal('1234500', 6) // '1.2345'
 * atomicToDecimal('2', 6)       // '0.000002'
 */
export function atomicToDecimal(amount: bigint | string, decimals: number): string {
  const raw = typeof amount === 'bigint' ? amount.toString() : amount.trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`atomicToDecimal: expected integer string, got "${raw}"`);
  }
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(`atomicToDecimal: decimals must be a non-negative integer (got ${decimals})`);
  }
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Convert a decimal string ("1.50") to its atomic integer (1500000n at 6
 * decimals). Returns `null` for malformed input — callers should treat
 * `null` as "leave the amount field blank, don't proceed".
 *
 * Rejects more decimal places than the token supports rather than silently
 * truncating, because losing dust to rounding when sending stablecoins is
 * a user-trust bug.
 */
export function decimalToAtomic(input: string, decimals: number): bigint | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const fracRaw = m[2] ?? '';
  if (fracRaw.length > decimals) return null;
  const frac = fracRaw.padEnd(decimals, '0');
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(frac || '0');
}

/**
 * Format a `ReceiptV1.price` for UI display. Atomic integer amounts are
 * resolved through the {@link KNOWN_TOKENS} registry when an `asset` mint is
 * present; otherwise we fall back to USDC's 6 decimals (the playground
 * default). Already-decimal strings (legacy receipts) pass through.
 */
export function formatReceiptPrice(
  price: ReceiptV1['price'] | undefined | null,
  network: TokenNetwork = 'devnet',
): string | null {
  if (!price) return null;
  const { amount, currency, asset } = price;
  if (!/^\d+$/.test(amount)) return amount;
  const decimals = resolveDecimals({ asset, currency, network });
  return atomicToDecimal(amount, decimals);
}

/** {@link formatReceiptPrice} + the currency ticker. */
export function formatReceiptPriceWithCurrency(
  price: ReceiptV1['price'] | undefined | null,
  network: TokenNetwork = 'devnet',
): string | null {
  if (!price) return null;
  const core = formatReceiptPrice(price, network);
  if (core === null) return null;
  return `${core} ${price.currency}`;
}

/**
 * USD-style display ("$1.23", "$0.001000") for stablecoin prices. Falls back
 * to {@link formatReceiptPriceWithCurrency} for non-stable currencies. Pad
 * the fractional part to **at least 2 decimals** so `$1` doesn't read as
 * truncated; preserve the long tail for sub-cent amounts so users see
 * exactly what they paid.
 */
export function formatReceiptPriceUsd(
  price: ReceiptV1['price'] | undefined | null,
  network: TokenNetwork = 'devnet',
): string | null {
  if (!price) return null;
  if (!STABLES.has(price.currency)) return formatReceiptPriceWithCurrency(price, network);
  const core = formatReceiptPrice(price, network);
  if (core === null) return null;
  if (/^\d+$/.test(core)) return `$${core}.00`;
  const [whole, frac = ''] = core.split('.');
  if (frac.length < 2) return `$${whole}.${frac.padEnd(2, '0')}`;
  return `$${core}`;
}

/**
 * Format a raw atomic balance against a known mint. Convenience wrapper
 * around {@link atomicToDecimal} that sources `decimals` from the registry.
 */
export function formatTokenBalance(
  amount: bigint | string,
  mint: string,
  network: TokenNetwork,
): string {
  const token = lookupToken(mint, network);
  const decimals = token?.decimals ?? 0;
  return atomicToDecimal(amount, decimals);
}

function resolveDecimals(args: {
  asset?: string | null;
  currency: string;
  network: TokenNetwork;
}): number {
  if (args.asset) {
    const known = lookupToken(args.asset, args.network);
    if (known) return known.decimals;
  }
  // Stablecoins are 6 decimals on Solana (USDC/USDT/USDG/PYUSD).
  if (STABLES.has(args.currency)) return 6;
  // Unknown non-stablecoins: leave atomic untouched. Better to show "5 BONK"
  // than silently divide by 1e6 and surface "0.000005 BONK" — which would be
  // a misleading payment amount in receipts.
  return 0;
}

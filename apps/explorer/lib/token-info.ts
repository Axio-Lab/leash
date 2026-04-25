/**
 * Token metadata + amount formatting for the explorer.
 *
 * On-chain transfer events carry only a raw atomic integer (e.g. `1000`)
 * and a mint address. Humans want `"0.001 USDC (~$0.001)"`. This module
 * resolves a (network, mint) pair to a `{ symbol, decimals, isStable }`
 * descriptor and exposes a single `formatTokenAmount` helper used by
 * every column / detail row that renders a token amount.
 *
 * The resolver is deliberately a static table keyed by mint address —
 * the explorer should never have to make an RPC call just to render
 * a row, and the universe of stablecoins we paywall against is small
 * and slow-moving. Unknown mints fall back to `{ symbol: 'tokens',
 * decimals: 6 }` which is the right default for SPL tokens minted via
 * mpl-toolbox.
 */
import type { Network } from './network';

export type TokenInfo = {
  symbol: string;
  decimals: number;
  /** stables get a 1:1 USD estimate appended in `formatTokenAmount`. */
  isStable: boolean;
};

const KNOWN: Record<string, TokenInfo> = {
  // USDC mainnet
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6, isStable: true },
  // USDT mainnet
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6, isStable: true },
  // USDC devnet (Circle's official faucet mint)
  Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr: { symbol: 'USDC', decimals: 6, isStable: true },
  // USDC devnet (Solana labs canonical)
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': {
    symbol: 'USDC',
    decimals: 6,
    isStable: true,
  },
};

const FALLBACK: TokenInfo = { symbol: 'tokens', decimals: 6, isStable: false };

export function tokenInfoFor(_network: Network, mint: string | null | undefined): TokenInfo {
  if (!mint) return FALLBACK;
  return KNOWN[mint] ?? FALLBACK;
}

/**
 * Render a raw atomic amount (string of base-10 digits) into a
 * human-readable token amount. Examples:
 *
 *   formatTokenAmount('1000', { symbol: 'USDC', decimals: 6, isStable: true })
 *     → '0.001 USDC (~$0.001)'
 *   formatTokenAmount('500000', { symbol: 'USDC', decimals: 6, isStable: true })
 *     → '0.5 USDC (~$0.50)'
 *   formatTokenAmount('1', { symbol: 'USDC', decimals: 6, isStable: true })
 *     → '0.000001 USDC (~$0.000001)'   // trailing zeros stripped
 *   formatTokenAmount('1000', { symbol: 'tokens', decimals: 6, isStable: false })
 *     → '0.001 tokens'
 */
export function formatTokenAmount(
  amountAtomic: string | null | undefined,
  info: TokenInfo,
  opts: { withUsd?: boolean } = {},
): string {
  if (!amountAtomic) return '—';
  let n: bigint;
  try {
    n = BigInt(amountAtomic);
  } catch {
    return amountAtomic;
  }
  const ui = atomicToUiString(n, info.decimals);
  const base = `${ui} ${info.symbol}`;
  if (opts.withUsd === false) return base;
  if (!info.isStable) return base;
  const usd = atomicToUiNumber(n, info.decimals);
  return `${base} (~${formatUsd(usd)})`;
}

/**
 * Pure decimal rendering with no symbol or USD — useful when a column
 * already carries the symbol separately (e.g. paired pill layouts).
 */
export function formatAtomicAsUi(
  amountAtomic: string | null | undefined,
  decimals: number,
): string {
  if (!amountAtomic) return '—';
  try {
    return atomicToUiString(BigInt(amountAtomic), decimals);
  } catch {
    return amountAtomic;
  }
}

function atomicToUiString(n: bigint, decimals: number): string {
  if (decimals === 0) return n.toString();
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

function atomicToUiNumber(n: bigint, decimals: number): number {
  return Number(n) / 10 ** decimals;
}

function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  // Sub-cent: render up to 6 decimals but strip trailing zeros so
  // `0.001 USDC` shows as `~$0.001` (not the misleading `~$0.0010`).
  if (amount < 0.01) {
    const fixed = amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return `$${fixed}`;
  }
  if (amount < 1) return `$${amount.toFixed(2)}`;
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

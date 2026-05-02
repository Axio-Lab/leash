/**
 * Links to Leash explorer (explorer.leash.market) for Leash-native
 * artifacts (receipts, agent pages), and Solscan for vanilla Solana
 * tx / account / mint links where the user expects the canonical
 * cluster explorer.
 */

import { NEXT_PUBLIC_EXPLORER_URL as ENV_EXPLORER, SOLANA_NETWORK } from './env';

const EXPLORER_BASE: string = ENV_EXPLORER.replace(/\/+$/, '');

export function explorerBase(): string {
  return EXPLORER_BASE;
}

export function receiptUrl(hash: string): string {
  const h = encodeURIComponent(hash.trim());
  return `${EXPLORER_BASE}/receipt/${h}`;
}

/** Agent mint address page */
export function agentUrl(mint: string): string {
  const m = encodeURIComponent(mint.trim());
  return `${EXPLORER_BASE}/agent/${m}`;
}

export function txUrl(sig: string): string {
  const s = encodeURIComponent(sig.trim());
  return `${EXPLORER_BASE}/tx/${s}`;
}

export function eventUrl(id: string): string {
  const i = encodeURIComponent(id.trim());
  return `${EXPLORER_BASE}/event/${i}`;
}

export function shortHash(hash: string, head = 6, tail = 4): string {
  const h = hash.trim();
  if (h.length <= head + tail) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/**
 * Solscan transaction URL with the right cluster suffix for the
 * configured network. Use this for withdrawals / treasury moves
 * where the user wants the canonical Solana explorer view, not a
 * Leash-side receipt page (we don't index every owner-driven tx).
 */
export function solscanTxUrl(sig: string, network: string = SOLANA_NETWORK): string {
  const s = encodeURIComponent(sig.trim());
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/tx/${s}${cluster}`;
}

/**
 * Solscan account / wallet URL with the right cluster suffix.
 */
export function solscanAccountUrl(address: string, network: string = SOLANA_NETWORK): string {
  const a = encodeURIComponent(address.trim());
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/account/${a}${cluster}`;
}

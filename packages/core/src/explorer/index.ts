/**
 * Explorer URL builders for Solana addresses, transactions, and Metaplex
 * Core agent assets. Used by Leash to stamp `tx_explorer` /
 * `agent_explorer` links into x402 response headers and to render "View on
 * Solscan" affordances in the playground UI.
 *
 * We default to Solscan (best UX for SPL transfers and Core assets) but
 * support `solana-explorer` (the official explorer.solana.com) as well.
 */

import type { TokenNetwork } from '../tokens/index.js';

export type ExplorerProvider = 'solscan' | 'solana-explorer';

export type ExplorerOptions = {
  /** Defaults to `'devnet'`. Mainnet links omit the `?cluster=` param. */
  network?: TokenNetwork;
  /** Defaults to `'solscan'`. */
  provider?: ExplorerProvider;
};

function clusterParam(network: TokenNetwork, provider: ExplorerProvider): string {
  if (network === 'mainnet') return '';
  if (provider === 'solscan') return '?cluster=devnet';
  return '?cluster=devnet';
}

function base(provider: ExplorerProvider): string {
  return provider === 'solscan' ? 'https://solscan.io' : 'https://explorer.solana.com';
}

/**
 * Explorer page for an SPL token transfer / x402 settlement. Returns
 * `null` when no signature is supplied so callers can pipe through `null`
 * fields from receipts without nullish-checking inline.
 */
export function transactionExplorerUrl(
  signature: string | null | undefined,
  opts: ExplorerOptions = {},
): string | null {
  if (!signature) return null;
  const provider = opts.provider ?? 'solscan';
  const network = opts.network ?? 'devnet';
  return `${base(provider)}/tx/${signature}${clusterParam(network, provider)}`;
}

/** Explorer page for a Metaplex Core agent asset (the agent mint address). */
export function agentExplorerUrl(
  mint: string | null | undefined,
  opts: ExplorerOptions = {},
): string | null {
  if (!mint) return null;
  // Core assets are addresses, so the address page gives the richest view
  // (asset metadata + holder history). Solscan also accepts /token but
  // /address surfaces the Core attributes plate.
  return addressExplorerUrl(mint, opts);
}

/** Explorer page for any Solana account / mint / PDA. */
export function addressExplorerUrl(
  address: string | null | undefined,
  opts: ExplorerOptions = {},
): string | null {
  if (!address) return null;
  const provider = opts.provider ?? 'solscan';
  const network = opts.network ?? 'devnet';
  const path = provider === 'solscan' ? 'account' : 'address';
  return `${base(provider)}/${path}/${address}${clusterParam(network, provider)}`;
}

/**
 * Default base for the Leash protocol explorer. Override via the
 * `baseUrl` option (or `LEASH_EXPLORER_URL` upstream) when running
 * against a self-hosted explorer or a staging deployment.
 */
export const LEASH_EXPLORER_DEFAULT = 'https://explorer.leash.market';

/**
 * Page on `explorer.leash.market` for a Leash receipt hash. Returns
 * `null` when no hash is supplied so callers can pipe through nullable
 * fields without inline checks.
 *
 * The hash should be the seller-side (canonical) `receipt_hash` — the
 * one stamped on the response via `X-Leash-Receipt-Hash`. The
 * buyer-kit's locally-computed hash is per-buyer-view and the explorer
 * does not index it.
 */
export function leashReceiptUrl(
  hash: string | null | undefined,
  opts: { baseUrl?: string } = {},
): string | null {
  if (!hash) return null;
  const trimmed = hash.trim();
  if (trimmed.length === 0) return null;
  const base = (opts.baseUrl ?? LEASH_EXPLORER_DEFAULT).replace(/\/+$/, '');
  return `${base}/receipt/${encodeURIComponent(trimmed)}`;
}

/** Page on `explorer.leash.market` for a Solana tx signature. */
export function leashTxUrl(
  signature: string | null | undefined,
  opts: { baseUrl?: string } = {},
): string | null {
  if (!signature) return null;
  const trimmed = signature.trim();
  if (trimmed.length === 0) return null;
  const base = (opts.baseUrl ?? LEASH_EXPLORER_DEFAULT).replace(/\/+$/, '');
  return `${base}/tx/${encodeURIComponent(trimmed)}`;
}

/** Page on `explorer.leash.market` for an agent (MPL Core asset). */
export function leashAgentUrl(
  mint: string | null | undefined,
  opts: { baseUrl?: string } = {},
): string | null {
  if (!mint) return null;
  const trimmed = mint.trim();
  if (trimmed.length === 0) return null;
  const base = (opts.baseUrl ?? LEASH_EXPLORER_DEFAULT).replace(/\/+$/, '');
  return `${base}/agent/${encodeURIComponent(trimmed)}`;
}

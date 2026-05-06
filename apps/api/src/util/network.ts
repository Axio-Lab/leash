/**
 * Network identifiers used everywhere in the API server. We use the
 * Metaplex `SvmNetwork` slugs (`solana-devnet`, `solana-mainnet`) as the
 * canonical form because that's what `@leashmarket/registry-utils` and the
 * Metaplex Genesis SDK already accept; CAIP-2 forms are reserved for
 * x402 receipts.
 */

export type SvmNetwork = 'solana-devnet' | 'solana-mainnet';

export const SVM_NETWORKS: readonly SvmNetwork[] = ['solana-devnet', 'solana-mainnet'] as const;

export function isSvmNetwork(s: string): s is SvmNetwork {
  return s === 'solana-devnet' || s === 'solana-mainnet';
}

/** Friendly name suitable for logs and explorer breadcrumbs. */
export function networkLabel(n: SvmNetwork): string {
  return n === 'solana-devnet' ? 'devnet' : 'mainnet';
}

/** CAIP-2 chain identifier mirrors `@leashmarket/schemas/networks.ts`. */
export function networkToCaip2(n: SvmNetwork): string {
  return n === 'solana-devnet'
    ? 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    : 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
}

/** Solscan deeplink for a given signature on the right cluster. */
export function solscanTxUrl(network: SvmNetwork, signature: string): string {
  const cluster = network === 'solana-devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

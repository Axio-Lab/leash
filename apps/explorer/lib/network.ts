/**
 * Strict 'devnet' | 'mainnet' switch the explorer uses everywhere.
 *
 * `network` is the source of truth for which Leash API key the
 * server-side fetcher reaches for, and for the cluster suffix on
 * outbound Solscan deeplinks. The browser only sees `'devnet' | 'mainnet'`
 * — never raw API keys.
 */

export type Network = 'devnet' | 'mainnet';

export const NETWORK_LABEL: Record<Network, string> = {
  devnet: 'Devnet',
  mainnet: 'Mainnet',
};

export function isNetwork(value: unknown): value is Network {
  return value === 'devnet' || value === 'mainnet';
}

export function networkFromCookie(value: string | undefined): Network {
  if (value === 'mainnet') return 'mainnet';
  return 'devnet';
}

export function networkToSlug(network: Network): 'solana-devnet' | 'solana-mainnet' {
  return network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet';
}

export function solscanCluster(network: Network): string {
  return network === 'mainnet' ? '' : '?cluster=devnet';
}

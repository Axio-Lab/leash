import type { Network } from './network';
import { solscanCluster } from './network';

export function solscanTxUrl(network: Network, signature: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}${solscanCluster(network)}`;
}

export function solscanAddrUrl(network: Network, address: string): string {
  return `https://solscan.io/address/${encodeURIComponent(address)}${solscanCluster(network)}`;
}

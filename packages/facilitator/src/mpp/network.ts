import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, SOLANA_TESTNET_CAIP2 } from '@x402/svm';

/**
 * Map MPP `request.network` (friendly slug or CAIP-2) to the canonical
 * CAIP-2 string {@link FacilitatorSvmSigner} expects on simulate/send.
 */
export function mppNetworkToCaip2(network: string): string | null {
  const n = network.trim().toLowerCase();
  if (n === 'solana-devnet') return SOLANA_DEVNET_CAIP2;
  if (n === 'solana-mainnet') return SOLANA_MAINNET_CAIP2;
  if (n === 'solana-testnet') return SOLANA_TESTNET_CAIP2;
  if (n.startsWith('solana:')) return network;
  return null;
}

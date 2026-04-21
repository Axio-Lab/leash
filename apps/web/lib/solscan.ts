/**
 * Open a mint / agent tx on Solscan when the cluster is supported; otherwise
 * fall back to Solana Explorer (Solscan has no URLs for localnet / some L2s).
 *
 * Accepts both human aliases (`solana-devnet`) and CAIP-2 ids (the genesis-
 * hash-prefixed form receipts now carry: `solana:5eykt4...`).
 */
const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const SOLANA_TESTNET_CAIP2 = 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z';

export function transactionExplorerUrl(network: string, signature: string): string {
  const sig = encodeURIComponent(signature);
  const solscanBase = `https://solscan.io/tx/${sig}`;

  if (network === 'solana-mainnet' || network === SOLANA_MAINNET_CAIP2) {
    return solscanBase;
  }
  if (
    network === 'solana-devnet' ||
    network === SOLANA_DEVNET_CAIP2 ||
    network === 'solana-testnet' ||
    network === SOLANA_TESTNET_CAIP2
  ) {
    return `${solscanBase}?cluster=devnet`;
  }
  if (network.endsWith('-mainnet')) {
    return solscanBase;
  }
  if (network.endsWith('-devnet') || network.endsWith('-testnet')) {
    return `${solscanBase}?cluster=devnet`;
  }
  if (network === 'localnet') {
    return `https://explorer.solana.com/tx/${sig}?cluster=custom`;
  }

  return `${solscanBase}?cluster=devnet`;
}

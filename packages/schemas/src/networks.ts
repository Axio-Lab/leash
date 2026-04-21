/** CAIP-2 chain ids for Solana (x402 / registry). */
export const SOLANA_MAINNET = 'solana:101' as const;
export const SOLANA_DEVNET = 'solana:103' as const;

export type SolanaNetworkId = typeof SOLANA_MAINNET | typeof SOLANA_DEVNET;

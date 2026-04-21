/**
 * CAIP-2 chain identifiers for Solana, used by `@leash/buyer-kit`,
 * `@leash/seller-kit`, registry documents, and `ReceiptV1.price.network`.
 *
 * Values match `@x402/svm` (`SOLANA_*_CAIP2`) so receipts and
 * `paymentRequirements` are byte-equivalent across the wire.
 *
 * The genesis-hash format is the formal CAIP-2 form for Solana
 * (see https://chainagnostic.org/CAIPs/caip-2). v0.0 used the legacy
 * placeholders `solana:101` / `solana:103`; do not reintroduce them —
 * they are not interoperable with x402 facilitators.
 */
export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
export const SOLANA_TESTNET = 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' as const;

export type SolanaNetworkId = typeof SOLANA_MAINNET | typeof SOLANA_DEVNET | typeof SOLANA_TESTNET;

/**
 * Human-readable cluster aliases (used by Solscan links and our UI). These
 * mirror the V1 names accepted by `@x402/svm`'s `normalizeNetwork` and are
 * safe to round-trip into CAIP-2 form via that helper.
 */
export type SolanaClusterAlias = 'solana-mainnet' | 'solana-devnet' | 'solana-testnet' | 'localnet';

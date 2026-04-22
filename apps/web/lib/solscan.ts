/**
 * Compatibility wrapper around `@leash/core`'s `transactionExplorerUrl`.
 *
 * The SDK's helper takes a `TokenNetwork` (`'mainnet' | 'devnet'`) and an
 * `ExplorerProvider`. The web playground historically passed the raw network
 * string from a receipt (CAIP-2 id, friendly slug, or even `'localnet'`),
 * so this shim translates that input shape to the SDK's API.
 *
 * New code in the playground should import `transactionExplorerUrl` from
 * `@leash/core` directly. This file exists purely to avoid a sweeping
 * call-site refactor of pages that already work.
 */

import { transactionExplorerUrl as sdkTransactionExplorerUrl } from '@leash/core';

const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export function transactionExplorerUrl(network: string, signature: string): string {
  const isMainnet =
    network === 'solana-mainnet' ||
    network === 'mainnet' ||
    network === SOLANA_MAINNET_CAIP2 ||
    network.endsWith('-mainnet');
  if (network === 'localnet') {
    return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=custom`;
  }
  return sdkTransactionExplorerUrl(signature, { network: isMainnet ? 'mainnet' : 'devnet' }) ?? '';
}

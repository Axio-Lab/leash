/**
 * Compatibility wrapper around `@leashmarket/core`'s `transactionExplorerUrl`.
 *
 * The SDK's helper takes a `TokenNetwork` (`'mainnet' | 'devnet'`) and an
 * `ExplorerProvider`. The web playground historically passed the raw network
 * string from a receipt (CAIP-2 id, friendly slug, or even `'localnet'`),
 * so this shim translates that input shape to the SDK's API.
 *
 * New code in the playground should import `transactionExplorerUrl` from
 * `@leashmarket/core` directly. This file exists purely to avoid a sweeping
 * call-site refactor of pages that already work.
 */

import {
  addressExplorerUrl as sdkAddressExplorerUrl,
  transactionExplorerUrl as sdkTransactionExplorerUrl,
} from '@leashmarket/core';

const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

function isMainnetLike(network: string): boolean {
  return (
    network === 'solana-mainnet' ||
    network === 'mainnet' ||
    network === SOLANA_MAINNET_CAIP2 ||
    network.endsWith('-mainnet')
  );
}

export function transactionExplorerUrl(network: string, signature: string): string {
  if (network === 'localnet') {
    return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=custom`;
  }
  return (
    sdkTransactionExplorerUrl(signature, {
      network: isMainnetLike(network) ? 'mainnet' : 'devnet',
    }) ?? ''
  );
}

/**
 * Same translation strategy as {@link transactionExplorerUrl} but for an
 * arbitrary Solana account (mint address, PDA, wallet). Used by the
 * agent profile page to deep-link out to a freshly launched token mint
 * or a treasury PDA.
 */
export function addressExplorerUrl(network: string, address: string): string {
  if (network === 'localnet') {
    return `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=custom`;
  }
  return (
    sdkAddressExplorerUrl(address, {
      network: isMainnetLike(network) ? 'mainnet' : 'devnet',
    }) ?? ''
  );
}

/**
 * Tiny helpers shared between the v1 + v2 Leash facilitator schemes.
 */

import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, SOLANA_TESTNET_CAIP2 } from '@x402/svm';
import type { TokenNetwork } from '@leash/core';

/**
 * Translate the raw `paymentRequirements.network` (CAIP-2 form on v2,
 * legacy `'solana-devnet'` slug on v1) into the {@link TokenNetwork}
 * enum we use everywhere else in `@leash/core`. Returns `null` for
 * networks the fee module doesn't manage (e.g. testnet, custom CAIP-2
 * chains) so the caller can fall back to upstream behaviour.
 */
export function networkFromCaip2ToTokenNetwork(
  network: string | undefined | null,
): TokenNetwork | null {
  if (!network) return null;
  const lower = network.toLowerCase();
  if (
    lower === SOLANA_MAINNET_CAIP2.toLowerCase() ||
    lower === 'solana-mainnet' ||
    lower === 'solana'
  ) {
    return 'mainnet';
  }
  if (lower === SOLANA_DEVNET_CAIP2.toLowerCase() || lower === 'solana-devnet') {
    return 'devnet';
  }
  if (lower === SOLANA_TESTNET_CAIP2.toLowerCase() || lower === 'solana-testnet') {
    // Testnet shares the devnet authority/treasury today — no separate
    // env var. We map it to devnet so testnet payloads still go through
    // the fee enforcement path consistently.
    return 'devnet';
  }
  return null;
}

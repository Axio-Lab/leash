/**
 * Leash-flavoured x402 scheme registrar.
 *
 * Replaces upstream `@x402/svm`'s `registerExactSvmScheme` so the
 * facilitator understands Leash protocol fee payloads (the optional
 * `TransferChecked` to the treasury ATA at instruction index 3).
 *
 * Behaviour:
 *   - V2 wire shape: register {@link LeashExactSvmFacilitator}.
 *   - V1 wire shape: register {@link LeashExactSvmFacilitatorV1} on the
 *     legacy `solana | solana-devnet | solana-testnet` slugs so older
 *     buyers still settle.
 *   - Both schemes share a single {@link SettlementCache} so a buyer
 *     can't double-settle by hopping protocol versions.
 */

import { x402Facilitator } from '@x402/core/facilitator';
import { SettlementCache, type FacilitatorSvmSigner } from '@x402/svm';
import type { Network } from '@x402/core/types';

import { LeashExactSvmFacilitator } from './leash-exact-svm.js';
import { LeashExactSvmFacilitatorV1 } from './leash-exact-svm-v1.js';

/** Legacy protocol-v1 network slugs. Same list upstream uses. */
const V1_NETWORKS = ['solana', 'solana-devnet', 'solana-testnet'] as const;

export type RegisterLeashExactSvmSchemeConfig = {
  /** SVM signer (fee payer + simulator). */
  signer: FacilitatorSvmSigner;
  /** Networks to register the scheme against (CAIP-2 form). */
  networks: Network | Network[];
};

/**
 * Register the Leash exact SVM scheme on both v2 and v1 of the wire.
 *
 * ```ts
 * const facilitator = new x402Facilitator();
 * registerLeashExactSvmScheme(facilitator, {
 *   signer,
 *   networks: [SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2],
 * });
 * ```
 */
export function registerLeashExactSvmScheme(
  facilitator: x402Facilitator,
  config: RegisterLeashExactSvmSchemeConfig,
): x402Facilitator {
  const settlementCache = new SettlementCache();
  facilitator.register(
    config.networks,
    new LeashExactSvmFacilitator({ signer: config.signer, settlementCache }),
  );
  facilitator.registerV1(
    V1_NETWORKS as unknown as Network[],
    new LeashExactSvmFacilitatorV1({ signer: config.signer, settlementCache }),
  );
  return facilitator;
}

export { LeashExactSvmFacilitator } from './leash-exact-svm.js';
export { LeashExactSvmFacilitatorV1 } from './leash-exact-svm-v1.js';
export type { LeashExactSvmFacilitatorOptions } from './leash-exact-svm.js';
export type { LeashExactSvmFacilitatorV1Options } from './leash-exact-svm-v1.js';

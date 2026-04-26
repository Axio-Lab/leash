import type { FacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';
import { SOLANA_DEVNET_CAIP2 } from '@x402/svm';

const FACILITATOR_FEEPAYER = 'FaciliTatoR1111111111111111111111111111111';

/**
 * In-memory x402 facilitator for Vitest and demo smoke tests. Avoids HTTP
 * round-trips to the default hosted facilitator (which may be unreachable
 * in CI or offline).
 */
export function stubFacilitator(opts?: { txSig?: string }): FacilitatorClient {
  let nonce = 0;
  return {
    async getSupported(): Promise<SupportedResponse> {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: SOLANA_DEVNET_CAIP2,
            extra: { feePayer: FACILITATOR_FEEPAYER },
          },
        ],
        extensions: [],
        signers: {},
      };
    },
    async verify(
      _payload: PaymentPayload,
      _requirements: PaymentRequirements,
    ): Promise<VerifyResponse> {
      return { isValid: true, payer: 'Buyer1111111111111111111111111111111111' };
    },
    async settle(
      _payload: PaymentPayload,
      requirements: PaymentRequirements,
    ): Promise<SettleResponse> {
      nonce += 1;
      return {
        success: true,
        transaction: `${opts?.txSig ?? 'sig'}-${nonce}`,
        network: requirements.network,
        payer: 'Buyer1111111111111111111111111111111111',
      };
    },
  };
}

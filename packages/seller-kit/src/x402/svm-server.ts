import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import type { FacilitatorClient } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, SOLANA_TESTNET_CAIP2 } from '@x402/svm';

export type LeashSellerNetwork = 'solana-mainnet' | 'solana-devnet' | 'solana-testnet';

const NETWORK_TO_CAIP2: Record<LeashSellerNetwork, Network> = {
  'solana-mainnet': SOLANA_MAINNET_CAIP2 as Network,
  'solana-devnet': SOLANA_DEVNET_CAIP2 as Network,
  'solana-testnet': SOLANA_TESTNET_CAIP2 as Network,
};

export function caip2ForSellerNetwork(network: LeashSellerNetwork): Network {
  return NETWORK_TO_CAIP2[network];
}

export const DEFAULT_FACILITATOR_URL = 'https://facilitator.svmacc.tech';

export type CreateSvmResourceServerOptions = {
  /** CAIP-2 networks the seller accepts. Defaults to `['solana-devnet']`. */
  networks?: LeashSellerNetwork[];
  /**
   * Hosted x402 facilitator. Defaults to `https://facilitator.svmacc.tech`,
   * the public SVM facilitator (gas-sponsored, no signup). Pass a different
   * URL or a fully-built `FacilitatorClient` to point at PayAI, Corbits, or
   * a self-hosted instance.
   */
  facilitator?: string | FacilitatorClient;
};

/**
 * Build an `x402ResourceServer` configured with the SVM exact-payment scheme
 * for one or more Solana clusters and a hosted facilitator client. This is
 * what `createSeller` registers under the hood; export it so advanced
 * callers can attach `onAfterSettle`/`onSettleFailure` hooks of their own.
 */
export function createSvmResourceServer(opts: CreateSvmResourceServerOptions = {}): {
  server: x402ResourceServer;
  facilitatorUrl: string | null;
} {
  const networks = opts.networks ?? ['solana-devnet'];
  const facilitatorClient: FacilitatorClient =
    typeof opts.facilitator === 'string'
      ? new HTTPFacilitatorClient({ url: opts.facilitator })
      : (opts.facilitator ?? new HTTPFacilitatorClient({ url: DEFAULT_FACILITATOR_URL }));

  const facilitatorUrl =
    facilitatorClient instanceof HTTPFacilitatorClient ? facilitatorClient.url : null;

  const server = new x402ResourceServer(facilitatorClient);
  const scheme = new ExactSvmScheme();
  for (const n of networks) {
    server.register(NETWORK_TO_CAIP2[n], scheme);
  }
  return { server, facilitatorUrl };
}

import { x402Client } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, SOLANA_TESTNET_CAIP2 } from '@x402/svm';
import type { ClientSvmSigner } from '@x402/svm';

export type LeashFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type LeashX402Network = 'solana-mainnet' | 'solana-devnet' | 'solana-testnet';

const NETWORK_TO_CAIP2: Record<LeashX402Network, Network> = {
  'solana-mainnet': SOLANA_MAINNET_CAIP2 as Network,
  'solana-devnet': SOLANA_DEVNET_CAIP2 as Network,
  'solana-testnet': SOLANA_TESTNET_CAIP2 as Network,
};

export function caip2ForNetwork(network: LeashX402Network): Network {
  return NETWORK_TO_CAIP2[network];
}

export type CreateSvmBuyerClientOptions = {
  signer: ClientSvmSigner;
  /**
   * Networks to register on the underlying x402Client. Defaults to all three
   * Solana clusters; only the ones the seller's `paymentRequirements` advertise
   * will actually be exercised.
   */
  networks?: LeashX402Network[];
  /** Optional custom RPC for transaction simulation/fetches. */
  rpcUrl?: string;
};

/**
 * Build a paid `fetch` for the buyer side of x402 on Solana.
 *
 * Wraps `globalThis.fetch` with `@x402/fetch`'s `wrapFetchWithPayment` and
 * registers `ExactSvmScheme` against the provided signer. The returned
 * function is a drop-in replacement for `fetch`: the first 402 response
 * triggers a real SPL `TransferChecked` payment, and the request is replayed
 * with `X-PAYMENT` attached.
 *
 * @example
 * ```ts
 * import { createKeyPairSignerFromBytes } from '@solana/kit';
 * import { createSvmBuyerFetch } from '@leash/core';
 *
 * const signer = await createKeyPairSignerFromBytes(secret);
 * const paidFetch = createSvmBuyerFetch({ signer, networks: ['solana-devnet'] });
 * const res = await paidFetch('https://merchant.example/api/data');
 * ```
 */
export function createSvmBuyerFetch(opts: CreateSvmBuyerClientOptions): LeashFetch {
  const networks = opts.networks ?? ['solana-mainnet', 'solana-devnet', 'solana-testnet'];
  const client = new x402Client();
  for (const n of networks) {
    client.register(NETWORK_TO_CAIP2[n], new ExactSvmScheme(opts.signer, { rpcUrl: opts.rpcUrl }));
  }
  return wrapFetchWithPayment(globalThis.fetch, client);
}

export { wrapFetchWithPayment, x402Client, ExactSvmScheme };
export type { ClientSvmSigner };

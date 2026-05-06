import { x402Client, x402HTTPClient } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, SOLANA_TESTNET_CAIP2 } from '@x402/svm';
import type { ClientSvmSigner } from '@x402/svm';
import { LeashDelegateExactSvmScheme, LeashExactSvmScheme } from './delegate-scheme.js';
import type { Address } from '@solana/kit';
import { detectProtocol } from '../payments/detect.js';

export type LeashFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Like `@x402/fetch` `wrapFetchWithPayment`, but returns MPP `402` responses
 * unchanged so the body stays valid for {@link detectProtocol} /
 * buyer-kit `tryMppRoute`. Upstream `wrapFetchWithPayment` reads
 * `response.text()` for every 402, which consumes MPP `problem+json`
 * before Leash can act on it.
 */
export function wrapFetchWithMppAwarePayment(
  fetchImpl: typeof globalThis.fetch,
  client: x402Client,
): LeashFetch {
  const httpClient = client instanceof x402HTTPClient ? client : new x402HTTPClient(client);
  return async (input, init) => {
    const request = new Request(input, init);
    const clonedRequest = request.clone();
    const response = await fetchImpl(request);
    if (response.status !== 402) {
      return response;
    }
    const det = await detectProtocol(response);
    if (det.protocol === 'mpp') {
      return response;
    }
    let paymentRequired;
    try {
      const getHeader = (name: string) => response.headers.get(name);
      let body: unknown;
      try {
        const responseText = await response.text();
        if (responseText) {
          body = JSON.parse(responseText) as unknown;
        }
      } catch {
        /* ignore */
      }
      paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, body);
    } catch (error) {
      throw new Error(
        `Failed to parse payment requirements: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
    const hookHeaders = await httpClient.handlePaymentRequired(paymentRequired);
    if (hookHeaders) {
      const hookRequest = clonedRequest.clone();
      for (const [key, value] of Object.entries(hookHeaders)) {
        hookRequest.headers.set(key, value);
      }
      const hookResponse = await fetchImpl(hookRequest);
      if (hookResponse.status !== 402) {
        return hookResponse;
      }
    }
    let paymentPayload;
    try {
      paymentPayload = await client.createPaymentPayload(paymentRequired);
    } catch (error) {
      throw new Error(
        `Failed to create payment payload: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    if (clonedRequest.headers.has('PAYMENT-SIGNATURE') || clonedRequest.headers.has('X-PAYMENT')) {
      throw new Error('Payment already attempted');
    }
    for (const [key, value] of Object.entries(paymentHeaders)) {
      clonedRequest.headers.set(key, value);
    }
    clonedRequest.headers.set(
      'Access-Control-Expose-Headers',
      'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE',
    );
    const secondResponse = await fetchImpl(clonedRequest);
    return secondResponse;
  };
}

export type LeashX402Network = 'solana-mainnet' | 'solana-devnet' | 'solana-testnet';

const NETWORK_TO_CAIP2: Record<LeashX402Network, Network> = {
  'solana-mainnet': SOLANA_MAINNET_CAIP2 as Network,
  'solana-devnet': SOLANA_DEVNET_CAIP2 as Network,
  'solana-testnet': SOLANA_TESTNET_CAIP2 as Network,
};

export function caip2ForNetwork(network: LeashX402Network): Network {
  return NETWORK_TO_CAIP2[network];
}

/**
 * Inverse of {@link caip2ForNetwork} — turn a CAIP-2 chain id (the form
 * x402 facilitators emit on the wire, e.g. `solana:EtWTRABZaYq6...`) into a
 * friendly Leash slug (`solana-devnet`). Falls back to the original input
 * for unknown chains so receipts written by older code still round-trip.
 *
 * Used everywhere a receipt's `price.network` is constructed from a payment-
 * required header so explorers display `solana-devnet` instead of the raw
 * `solana:<genesis>` blob.
 */
export function networkFromCaip2(input: string | null | undefined): string | null {
  if (!input) return null;
  const lower = input.toLowerCase();
  if (lower === 'solana-mainnet' || lower === 'solana-devnet' || lower === 'solana-testnet') {
    return lower;
  }
  // Match by genesis-hash prefix (CAIP-2 truncates to 32 chars).
  if (lower.startsWith('solana:5eykt4u')) return 'solana-mainnet';
  if (lower.startsWith('solana:etwtrabz')) return 'solana-devnet';
  if (lower.startsWith('solana:4uhcvjyu')) return 'solana-testnet';
  return input;
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
  /**
   * If set, payments use {@link LeashDelegateExactSvmScheme} with this account
   * as the source of funds and `signer` as the SPL delegate authority. Use this
   * to spend from an agent treasury PDA's USDC ATA — the executive (Privy
   * embedded wallet) signs but the funds debit from the agent's PDA.
   *
   * If omitted, the default `ExactSvmScheme` is used (signer also owns funds).
   */
  sourceTokenAccount?: Address | string;
  /**
   * SPL mint address the buyer prefers to settle in. When the seller offers
   * multiple `accepts[]` (e.g. USDC + USDG), the underlying `x402Client`
   * selector picks the entry whose `asset` matches this mint. Falls back to
   * the first compatible entry when no preferred match exists, so a request
   * never fails just because the buyer's preference is unavailable.
   */
  preferredAsset?: string;
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
 * import { createSvmBuyerFetch } from '@leashmarket/core';
 *
 * const signer = await createKeyPairSignerFromBytes(secret);
 * const paidFetch = createSvmBuyerFetch({ signer, networks: ['solana-devnet'] });
 * const res = await paidFetch('https://merchant.example/api/data');
 * ```
 */
export function createSvmBuyerFetch(opts: CreateSvmBuyerClientOptions): LeashFetch {
  const networks = opts.networks ?? ['solana-mainnet', 'solana-devnet', 'solana-testnet'];
  const preferredAsset = opts.preferredAsset?.trim();
  // The default selector picks `paymentRequirements[0]`. We override it to
  // honour the buyer's preferred mint when the seller advertises multiple
  // `accepts[]` (e.g. a USDC link that also accepts USDG / USDT).

  const client = preferredAsset
    ? new x402Client((_v, reqs) => {
        const match = reqs.find((r) => r.asset === preferredAsset);
        if (match) return match;
        const offered = Array.from(new Set(reqs.map((r) => r.asset).filter(Boolean))).join(', ');
        throw new Error(
          `preferred_asset_unavailable: requested ${preferredAsset}; seller offers ${offered || '<none>'}`,
        );
      })
    : new x402Client();
  for (const n of networks) {
    // Both Leash schemes append the protocol fee leg when the seller's
    // `paymentRequirements.extra['leash.fee']` is present and degrade
    // to the upstream wire shape otherwise — so callers don't need to
    // branch on whether the seller is using a Leash facilitator.
    const scheme = opts.sourceTokenAccount
      ? new LeashDelegateExactSvmScheme({
          signer: opts.signer,
          sourceTokenAccount: opts.sourceTokenAccount,
          ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
        })
      : new LeashExactSvmScheme({
          signer: opts.signer,
          ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
        });
    client.register(NETWORK_TO_CAIP2[n], scheme);
  }
  return wrapFetchWithMppAwarePayment(globalThis.fetch, client);
}

export {
  wrapFetchWithPayment,
  x402Client,
  ExactSvmScheme,
  LeashDelegateExactSvmScheme,
  LeashExactSvmScheme,
};
export type { ClientSvmSigner };

import { x402Client } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, SOLANA_TESTNET_CAIP2 } from '@x402/svm';
import type { ClientSvmSigner } from '@x402/svm';
import { LeashDelegateExactSvmScheme } from './delegate-scheme.js';
import type { Address } from '@solana/kit';

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
    const scheme = opts.sourceTokenAccount
      ? new LeashDelegateExactSvmScheme({
          signer: opts.signer,
          sourceTokenAccount: opts.sourceTokenAccount,
          ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
        })
      : new ExactSvmScheme(opts.signer, { rpcUrl: opts.rpcUrl });
    client.register(NETWORK_TO_CAIP2[n], scheme);
  }
  return wrapFetchWithPayment(globalThis.fetch, client);
}

export { wrapFetchWithPayment, x402Client, ExactSvmScheme, LeashDelegateExactSvmScheme };
export type { ClientSvmSigner };

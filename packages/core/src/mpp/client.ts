/**
 * MPP-on-Solana buyer client.
 *
 * Mirrors {@link createSvmBuyerFetch} (x402 client) but speaks the MPP
 * wire shape: GET -> 402 with `application/problem+json` body ->
 * build SPL `TransferChecked` matching `request.recipient/amount/asset`
 * -> sign -> POST credential to facilitator (or local-settle) -> retry
 * the original request with `Authorization: PaymentScheme <b64>` and
 * carry the settlement metadata back to the caller.
 *
 * The returned `paidFetch` is a drop-in replacement for `fetch`, so
 * buyer-kit can layer dual-protocol routing on top via
 * {@link detectProtocol} without splitting its public API.
 */

import {
  address as toAddress,
  type Address,
  type TransactionSigner,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  prependTransactionMessageInstruction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  setTransactionMessageComputeUnitPrice,
} from '@solana-program/compute-budget';
import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createRpcClient, MEMO_PROGRAM_ADDRESS, MAX_MEMO_BYTES } from '@x402/svm';
import type { ClientSvmSigner } from '@x402/svm';
import type { MppChallengeV1 } from '@leashmarket/schemas';

import { type LeashFetch, type LeashX402Network } from '../x402/client.js';
import { defaultFacilitatorFor } from '../x402/facilitator.js';
import { buildMppAuthorizationHeader, type MppCredentialV1 } from './headers.js';
import { parseMppChallenge } from './parse.js';

const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;
const DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 10_000;

export type CreateSvmMppFetchOptions = {
  /** Authority that signs the SPL transfer (delegate or owner of `sourceTokenAccount`). */
  signer: ClientSvmSigner;
  /**
   * Solana clusters to allow. The buyer rejects challenges whose `network`
   * is not in this list. Defaults to all three Solana clusters.
   */
  networks?: LeashX402Network[];
  /** Optional RPC endpoint override forwarded to `@x402/svm` helpers. */
  rpcUrl?: string;
  /**
   * If set, the SPL transfer debits from this token account and `signer`
   * signs as the SPL **delegate** (mirror of LeashDelegateExactSvmScheme).
   * Leave undefined for "signer pays from their own ATA".
   */
  sourceTokenAccount?: Address | string;
  /**
   * Facilitator URL the seller forwards credentials to. Buyers don't talk
   * to the facilitator directly — the seller does — but we record it on
   * the receipt so explorers can re-verify settlement. Defaults to the
   * Leash devnet/mainnet facilitator depending on `networks`.
   */
  facilitatorUrl?: string;
};

/**
 * Settlement output the buyer-kit layer reads off the wire after the
 * retry succeeds. Fields are populated from response headers stamped by
 * the seller (mirrors x402's `PAYMENT-RESPONSE`).
 */
export type MppSettlement = {
  challengeId: string;
  /** Solana SPL transfer signature that satisfied the challenge. */
  settlementTx: string;
  settlementSlot: string | number;
};

/**
 * Per-call result carried through the wrapped fetch so buyer-kit can
 * stamp it onto a `ReceiptV02Mpp`. Exposed here so consumers writing
 * their own client (without buyer-kit) can read it too.
 */
export type MppPaidResponse = {
  response: Response;
  challenge: MppChallengeV1;
  settlement: MppSettlement | null;
};

/**
 * Build a paid `fetch` for MPP-on-Solana. Returns a function that
 * accepts the same args as `fetch` and resolves to a regular `Response`.
 * Buyer-kit (Phase 3) layers a richer return shape via the dual-fetch
 * orchestrator; this raw fetch is convenient for tests + standalone use.
 */
export function createSvmMppFetch(opts: CreateSvmMppFetchOptions): LeashFetch {
  const allowedNetworks = new Set(
    (opts.networks ?? ['solana-mainnet', 'solana-devnet', 'solana-testnet']) as string[],
  );
  const facilitatorUrl = opts.facilitatorUrl ?? defaultFacilitatorFor(opts.networks);

  return async function mppFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const firstResponse = await globalThis.fetch(input, init);
    if (firstResponse.status !== 402) return firstResponse;
    // Caller may have signalled a non-MPP 402 (x402). Fall back to the
    // original response so the dual-protocol orchestrator can route.
    let challenge: MppChallengeV1;
    try {
      challenge = await parseMppChallenge(firstResponse);
    } catch {
      return firstResponse;
    }
    if (!allowedNetworks.has(challenge.request.network)) {
      throw new Error(
        `mpp: seller asked for network "${challenge.request.network}" which is not in allowedNetworks`,
      );
    }
    const signedTx = await buildAndSignMppTransfer({
      challenge,
      signer: opts.signer,
      sourceTokenAccount: opts.sourceTokenAccount,
      ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    });
    const credential: MppCredentialV1 = {
      v: '1',
      challengeId: challenge.challengeId,
      signedTx,
    };
    const authHeader = buildMppAuthorizationHeader(credential);
    const retryInit: RequestInit = {
      ...(init ?? {}),
      headers: mergeAuthorizationHeader(init?.headers, authHeader),
    };
    const settled = await globalThis.fetch(input, retryInit);
    return attachFacilitatorOnResponse(settled, facilitatorUrl);
  };
}

/**
 * Lower-level: build and sign the SPL transfer that satisfies the
 * challenge. Exported so seller-kit tests and the explorer can replay
 * the buyer side without a real network call.
 */
export async function buildAndSignMppTransfer(args: {
  challenge: MppChallengeV1;
  signer: ClientSvmSigner;
  sourceTokenAccount?: Address | string;
  rpcUrl?: string;
}): Promise<string> {
  const { challenge, signer } = args;
  // `createRpcClient` accepts the CAIP-2 / friendly slug forms x402 already
  // emits; cast at the boundary so we can keep the schema's `string` shape.
  const rpc = createRpcClient(challenge.request.network as `${string}:${string}`, args.rpcUrl);
  const tokenMint = await fetchMint(rpc, challenge.request.asset as Address);
  const tokenProgramAddress = tokenMint.programAddress;
  if (
    tokenProgramAddress.toString() !== TOKEN_PROGRAM_ADDRESS.toString() &&
    tokenProgramAddress.toString() !== TOKEN_2022_PROGRAM_ADDRESS.toString()
  ) {
    throw new Error('mpp: asset was not created by a known token program');
  }

  let source: Address;
  if (args.sourceTokenAccount) {
    source =
      typeof args.sourceTokenAccount === 'string'
        ? (toAddress(args.sourceTokenAccount) as Address)
        : args.sourceTokenAccount;
  } else {
    const [ownerAta] = await findAssociatedTokenPda({
      mint: challenge.request.asset as Address,
      owner: signer.address,
      tokenProgram: tokenProgramAddress,
    });
    source = ownerAta;
  }

  const [destinationATA] = await findAssociatedTokenPda({
    mint: challenge.request.asset as Address,
    owner: challenge.request.recipient as Address,
    tokenProgram: tokenProgramAddress,
  });

  const feePayerAddress: Address = challenge.request.feePayer
    ? (toAddress(challenge.request.feePayer) as Address)
    : signer.address;
  const feePayerSigner = feePayerAddress as unknown as TransactionSigner<string>;

  const provisionSellerAtaIx = getCreateAssociatedTokenIdempotentInstruction({
    payer: feePayerSigner,
    ata: destinationATA,
    owner: challenge.request.recipient as Address,
    mint: challenge.request.asset as Address,
    tokenProgram: tokenProgramAddress,
  });

  const transferIx = getTransferCheckedInstruction(
    {
      source,
      mint: challenge.request.asset as Address,
      destination: destinationATA,
      authority: signer,
      amount: BigInt(challenge.request.amount),
      decimals: tokenMint.data.decimals,
    },
    { programAddress: tokenProgramAddress },
  );

  // Memo binds challengeId to the on-chain tx so the facilitator can
  // verify that this signed transfer matches the challenge it received.
  const memoBytes = new TextEncoder().encode(`mpp:${challenge.challengeId}`);
  if (memoBytes.byteLength > MAX_MEMO_BYTES) {
    throw new Error(`mpp: challengeId memo exceeds maximum ${MAX_MEMO_BYTES} bytes`);
  }
  const memoIx = {
    programAddress: MEMO_PROGRAM_ADDRESS as Address,
    accounts: [] as const,
    data: memoBytes,
  };

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (t) => setTransactionMessageComputeUnitPrice(DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS, t),
    (t) => setTransactionMessageFeePayer(feePayerAddress, t),
    (t) =>
      prependTransactionMessageInstruction(
        getSetComputeUnitLimitInstruction({ units: DEFAULT_COMPUTE_UNIT_LIMIT }),
        t,
      ),
    (t) => appendTransactionMessageInstructions([provisionSellerAtaIx, transferIx, memoIx], t),
    (t) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, t),
  );
  const signed = await partiallySignTransactionMessageWithSigners(tx);
  return getBase64EncodedWireTransaction(signed);
}

function mergeAuthorizationHeader(existing: RequestInit['headers'], authValue: string): Headers {
  const h = new Headers((existing ?? {}) as Record<string, string> | Headers);
  h.set('authorization', authValue);
  return h;
}

/**
 * Pass-through for now — placeholder for future client-side telemetry
 * (e.g. recording the facilitator URL on a debug wrapper). Keeps the
 * call-site readable and gives us a single hook for future logic.
 */
function attachFacilitatorOnResponse(response: Response, _facilitatorUrl: string): Response {
  return response;
}

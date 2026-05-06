/**
 * x402 SVM payment scheme variants used by Leash buyers. Both schemes
 * are wire-compatible with the upstream `@x402/svm` Exact scheme but
 * append the **Leash protocol fee leg** when the seller's
 * `paymentRequirements.extra['leash.fee']` block is present.
 *
 * Two variants are exported:
 *
 *   - {@link LeashExactSvmScheme} — the buyer signs as the **owner** of
 *     the source ATA. Drop-in replacement for the vanilla
 *     `@x402/svm` `ExactSvmScheme`; the only difference is the optional
 *     fee leg.
 *
 *   - {@link LeashDelegateExactSvmScheme} — the source ATA is provided
 *     externally (e.g. an agent treasury PDA's USDC ATA) and the buyer
 *     signs as the **SPL delegate** of that account. Used by Leash
 *     agents whose Privy embedded wallet is the delegate of a treasury
 *     it doesn't own.
 *
 * Transaction shape (with fee leg + auto-provisioning of destination ATAs):
 *
 *   ix[0] SetComputeUnitLimit
 *   ix[1] SetComputeUnitPrice
 *   ix[2] CreateAssociatedTokenAccountIdempotent (seller `payTo` ATA; payer = facilitator)
 *   ix[3] CreateAssociatedTokenAccountIdempotent (fee vault ATA;     payer = facilitator)
 *   ix[4] TransferChecked  (seller leg, amount = paymentRequirements.amount)
 *   ix[5] TransferChecked  (fee leg,    amount = extra['leash.fee'].feeAtomic)
 *   ix[6] Memo
 *
 * Idempotent creates are always emitted so first-time settlements on a
 * fresh mint (e.g. devnet USDG) succeed without an out-of-band ATA-init.
 * The facilitator skips any leading idempotent ATA creates whose target
 * matches the seller-`payTo` or fee-vault ATA.
 *
 * When `extra['leash.fee']` is absent (vanilla x402 seller, no Leash
 * facilitator), the fee leg is skipped and the transaction degrades to
 * the upstream 4-instruction shape: `[setLimit, setPrice, transfer, memo]`.
 *
 * Both legs share the same authority + source ATA, so a single signature
 * covers both. Atomicity is guaranteed by Solana's all-or-nothing
 * transaction semantics — either the seller AND treasury get paid, or
 * neither does.
 */
import { address as toAddress, type Address, type TransactionSigner } from '@solana/kit';
import {
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
import { createRpcClient, MAX_MEMO_BYTES, MEMO_PROGRAM_ADDRESS } from '@x402/svm';
import type { ClientSvmSigner } from '@x402/svm';
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';

import { computeLeashFeeForRequirements, parseLeashFeeExtra } from '../fees/leash-fee.js';
import type { TokenNetwork } from '../tokens/index.js';

/** Map x402 `paymentRequirements.network` (CAIP-2) to fee-module network. */
function tokenNetworkFromPaymentNetwork(network: string): TokenNetwork {
  const lower = network.toLowerCase();
  if (lower === 'solana-mainnet' || lower.startsWith('solana:5eykt4u')) return 'mainnet';
  return 'devnet';
}

const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;
const DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 10_000;

export type LeashDelegateExactSvmSchemeOptions = {
  /** Authority that will sign the TransferChecked. Must be the SPL delegate of `sourceTokenAccount`. */
  signer: ClientSvmSigner;
  /**
   * The token account that funds the transfer (e.g. the agent treasury's
   * USDC ATA). Funds debit from here, not from the signer's wallet.
   */
  sourceTokenAccount: Address | string;
  /** Optional RPC endpoint override forwarded to `@x402/svm` helpers. */
  rpcUrl?: string;
};

export type LeashExactSvmSchemeOptions = {
  /** Owner-as-signer. Source ATA is derived from `signer.address` + `asset`. */
  signer: ClientSvmSigner;
  /** Optional RPC endpoint override forwarded to `@x402/svm` helpers. */
  rpcUrl?: string;
};

/**
 * SVM client implementation of the x402 "exact" scheme that signs as a
 * **delegate** of an externally owned source ATA. Wire-compatible with
 * the vanilla `ExactSvmScheme` plus the Leash protocol fee leg.
 *
 * @example
 * ```ts
 * import { x402Client } from '@x402/core/client';
 * import { LeashDelegateExactSvmScheme } from '@leashmarket/core';
 *
 * const client = new x402Client();
 * client.register('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1XkXr8aBmpfk5', new LeashDelegateExactSvmScheme({
 *   signer: privySigner,
 *   sourceTokenAccount: agentUsdcAta,
 * }));
 * ```
 */
export class LeashDelegateExactSvmScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';
  private readonly signer: ClientSvmSigner;
  private readonly sourceTokenAccount: Address;
  private readonly rpcUrl?: string;

  constructor(options: LeashDelegateExactSvmSchemeOptions) {
    this.signer = options.signer;
    this.sourceTokenAccount =
      typeof options.sourceTokenAccount === 'string'
        ? (toAddress(options.sourceTokenAccount) as Address)
        : options.sourceTokenAccount;
    this.rpcUrl = options.rpcUrl;
  }

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    return buildLeashPaymentPayload({
      x402Version,
      paymentRequirements,
      signer: this.signer,
      sourceTokenAccount: this.sourceTokenAccount,
      ...(this.rpcUrl ? { rpcUrl: this.rpcUrl } : {}),
    });
  }
}

/**
 * SVM client implementation of the x402 "exact" scheme where the buyer
 * signs as the **owner** of the source ATA (i.e. their own wallet).
 * Replaces the upstream `@x402/svm` `ExactSvmScheme` for Leash buyers
 * who want the Leash protocol fee leg appended whenever the seller
 * advertises one.
 *
 * Falls back to the upstream wire shape when no fee block is present,
 * so this scheme can be used unconditionally — calling code does not
 * need to branch based on the seller's facilitator.
 */
export class LeashExactSvmScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';
  private readonly signer: ClientSvmSigner;
  private readonly rpcUrl?: string;

  constructor(options: LeashExactSvmSchemeOptions) {
    this.signer = options.signer;
    this.rpcUrl = options.rpcUrl;
  }

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    return buildLeashPaymentPayload({
      x402Version,
      paymentRequirements,
      signer: this.signer,
      sourceTokenAccount: null, // derive from signer.address
      ...(this.rpcUrl ? { rpcUrl: this.rpcUrl } : {}),
    });
  }
}

type BuildArgs = {
  x402Version: number;
  paymentRequirements: PaymentRequirements;
  signer: ClientSvmSigner;
  /**
   * Explicit source ATA when signing as a delegate; `null` when the
   * source should be derived from `signer.address` + `asset` (owner mode).
   */
  sourceTokenAccount: Address | null;
  rpcUrl?: string;
};

/**
 * Shared payload builder used by both Leash schemes. Walks the seller's
 * `paymentRequirements`, fetches the mint to learn its token program +
 * decimals, builds the seller `TransferChecked` leg, optionally appends
 * the Leash fee leg, and signs the resulting transaction as the buyer.
 *
 * The fee leg is built using the seller-supplied `extra['leash.fee']`
 * block as the source of truth (so the buyer doesn't have to care about
 * which env vars the seller ran with). The facilitator independently
 * recomputes everything in `verify`, so a tampered seller can't trick
 * the buyer into overpaying — the worst case is a `verify` failure.
 */
async function buildLeashPaymentPayload(
  args: BuildArgs,
): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
  const { x402Version, paymentRequirements, signer, sourceTokenAccount } = args;
  const rpc = createRpcClient(paymentRequirements.network, args.rpcUrl);
  const tokenMint = await fetchMint(rpc, paymentRequirements.asset as Address);
  const tokenProgramAddress = tokenMint.programAddress;
  if (
    tokenProgramAddress.toString() !== TOKEN_PROGRAM_ADDRESS.toString() &&
    tokenProgramAddress.toString() !== TOKEN_2022_PROGRAM_ADDRESS.toString()
  ) {
    throw new Error('Asset was not created by a known token program');
  }

  // Resolve source ATA: explicit (delegate mode) or derived (owner mode).
  let source: Address;
  if (sourceTokenAccount) {
    source = sourceTokenAccount;
  } else {
    const [ownerAta] = await findAssociatedTokenPda({
      mint: paymentRequirements.asset as Address,
      owner: signer.address,
      tokenProgram: tokenProgramAddress,
    });
    source = ownerAta;
  }

  const [destinationATA] = await findAssociatedTokenPda({
    mint: paymentRequirements.asset as Address,
    owner: paymentRequirements.payTo as Address,
    tokenProgram: tokenProgramAddress,
  });

  const transferIx = getTransferCheckedInstruction(
    {
      source,
      mint: paymentRequirements.asset as Address,
      destination: destinationATA,
      authority: signer,
      amount: BigInt(paymentRequirements.amount),
      decimals: tokenMint.data.decimals,
    },
    { programAddress: tokenProgramAddress },
  );

  // Build the optional fee leg. The wire shape only carries (bps,
  // feeAuthority); we recompute (feeAtomic, feeDestination) here from
  // the same inputs the facilitator uses, so both sides agree without
  // the seller having to pre-derive an ATA. If the seller tampers with
  // bps or feeAuthority, the facilitator's independent recomputation
  // rejects the transaction at verify time.
  const feeExtra = parseLeashFeeExtra(
    (paymentRequirements.extra ?? null) as Record<string, unknown> | null,
  );
  const tokenProgramKind: 'spl-token' | 'spl-token-2022' =
    tokenProgramAddress.toString() === TOKEN_2022_PROGRAM_ADDRESS.toString()
      ? 'spl-token-2022'
      : 'spl-token';
  const resolvedFee = await computeLeashFeeForRequirements({
    network: tokenNetworkFromPaymentNetwork(paymentRequirements.network as string),
    asset: paymentRequirements.asset as string,
    tokenProgram: tokenProgramKind,
    amount: paymentRequirements.amount as string,
    extra: feeExtra,
  });
  const feeIx =
    resolvedFee && resolvedFee.feeAtomic > 0n
      ? getTransferCheckedInstruction(
          {
            source,
            mint: paymentRequirements.asset as Address,
            destination: resolvedFee.feeDestination,
            authority: signer,
            amount: resolvedFee.feeAtomic,
            decimals: tokenMint.data.decimals,
          },
          { programAddress: tokenProgramAddress },
        )
      : null;

  const feePayer = (paymentRequirements.extra as { feePayer?: Address } | undefined)?.feePayer;
  if (!feePayer) {
    throw new Error('feePayer is required in paymentRequirements.extra for SVM transactions');
  }
  /** Create-ATA helper types `payer` as a signer; the facilitator co-signs later. */
  const feePayerSigner = feePayer as unknown as TransactionSigner<string>;

  /**
   * Ensure the seller `payTo` ATA exists before `TransferChecked`. New
   * stables (devnet USDG, etc.) frequently land on a wallet that has
   * never received that mint, so the seller ATA hasn't been created.
   * Idempotent — a no-op (small CU cost) when it already exists.
   */
  const provisionSellerAtaIx = getCreateAssociatedTokenIdempotentInstruction({
    payer: feePayerSigner,
    ata: destinationATA,
    owner: paymentRequirements.payTo as Address,
    mint: paymentRequirements.asset as Address,
    tokenProgram: tokenProgramAddress,
  });

  /** Ensures the fee vault ATA exists before the second `TransferChecked`. */
  const provisionFeeVaultAtaIx =
    resolvedFee && resolvedFee.feeAtomic > 0n
      ? getCreateAssociatedTokenIdempotentInstruction({
          payer: feePayerSigner,
          ata: resolvedFee.feeDestination,
          owner: resolvedFee.feeAuthority,
          mint: paymentRequirements.asset as Address,
          tokenProgram: tokenProgramAddress,
        })
      : null;

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const sellerMemo = (paymentRequirements.extra as { memo?: string } | undefined)?.memo;
  let memoData: Uint8Array;
  if (sellerMemo) {
    memoData = new TextEncoder().encode(sellerMemo);
    if (memoData.byteLength > MAX_MEMO_BYTES) {
      throw new Error(`extra.memo exceeds maximum ${MAX_MEMO_BYTES} bytes`);
    }
  } else {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    memoData = new TextEncoder().encode(
      Array.from(nonce)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    );
  }
  const memoIx = {
    programAddress: MEMO_PROGRAM_ADDRESS as Address,
    accounts: [] as const,
    data: memoData,
  };

  // Order: [setLimit, setPrice, sellerAtaCreate, feeAtaCreate?, transferIx, feeIx?, memoIx].
  // ATA creates are paid for by the facilitator (`feePayer`) so a fresh
  // mint settles first try without the buyer pre-funding rent.
  const trailingIxs = feeIx
    ? provisionFeeVaultAtaIx
      ? [provisionSellerAtaIx, provisionFeeVaultAtaIx, transferIx, feeIx, memoIx]
      : [provisionSellerAtaIx, transferIx, feeIx, memoIx]
    : [provisionSellerAtaIx, transferIx, memoIx];

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (t) => setTransactionMessageComputeUnitPrice(DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS, t),
    (t) => setTransactionMessageFeePayer(feePayer, t),
    (t) =>
      prependTransactionMessageInstruction(
        getSetComputeUnitLimitInstruction({ units: DEFAULT_COMPUTE_UNIT_LIMIT }),
        t,
      ),
    (t) => appendTransactionMessageInstructions(trailingIxs, t),
    (t) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, t),
  );
  const signedTransaction = await partiallySignTransactionMessageWithSigners(tx);
  const base64EncodedWireTransaction = getBase64EncodedWireTransaction(signedTransaction);
  return {
    x402Version,
    payload: { transaction: base64EncodedWireTransaction },
  };
}

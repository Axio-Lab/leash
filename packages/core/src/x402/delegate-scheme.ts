/**
 * x402 SVM payment scheme variant where the **source token account is
 * an externally provided ATA** (e.g. an agent's PDA-owned USDC ATA) and
 * the **authority is a delegate** that holds an SPL Token Approve.
 *
 * This is the wire-compatible alternative to forking the facilitator: by
 * issuing a vanilla `TransferChecked` whose `authority` is the delegate
 * recorded on the source ATA, every existing Solana facilitator
 * (svmacc, PayAI, x402.org, Coinbase CDP) settles the payment without
 * any protocol changes.
 *
 * Compare to `@x402/svm`'s built-in `ExactSvmScheme`, which derives the
 * source ATA from `signer.address` (i.e. assumes the signer also owns
 * the funds). For Leash agents that's wrong — the executive (Privy
 * embedded wallet) signs, but the funds live on the agent treasury PDA.
 *
 * Set up the delegation once with `setSpendDelegation` from
 * `@leash/registry-utils`; the agent treasury then debits naturally on
 * every settled call.
 */
import { address as toAddress, type Address } from '@solana/kit';
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
  getTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createRpcClient, MAX_MEMO_BYTES, MEMO_PROGRAM_ADDRESS } from '@x402/svm';
import type { ClientSvmSigner } from '@x402/svm';
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';

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

/**
 * SVM client implementation of the x402 "exact" scheme that signs as a
 * **delegate** of an externally owned source ATA. Wire-compatible with
 * the vanilla `ExactSvmScheme` — only the source account derivation
 * differs.
 *
 * @example
 * ```ts
 * import { x402Client } from '@x402/core/client';
 * import { LeashDelegateExactSvmScheme } from '@leash/core';
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
    const rpc = createRpcClient(paymentRequirements.network, this.rpcUrl);
    const tokenMint = await fetchMint(rpc, paymentRequirements.asset as Address);
    const tokenProgramAddress = tokenMint.programAddress;
    if (
      tokenProgramAddress.toString() !== TOKEN_PROGRAM_ADDRESS.toString() &&
      tokenProgramAddress.toString() !== TOKEN_2022_PROGRAM_ADDRESS.toString()
    ) {
      throw new Error('Asset was not created by a known token program');
    }

    const [destinationATA] = await findAssociatedTokenPda({
      mint: paymentRequirements.asset as Address,
      owner: paymentRequirements.payTo as Address,
      tokenProgram: tokenProgramAddress,
    });

    const transferIx = getTransferCheckedInstruction(
      {
        source: this.sourceTokenAccount,
        mint: paymentRequirements.asset as Address,
        destination: destinationATA,
        authority: this.signer,
        amount: BigInt(paymentRequirements.amount),
        decimals: tokenMint.data.decimals,
      },
      { programAddress: tokenProgramAddress },
    );

    const feePayer = (paymentRequirements.extra as { feePayer?: Address } | undefined)?.feePayer;
    if (!feePayer) {
      throw new Error('feePayer is required in paymentRequirements.extra for SVM transactions');
    }

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

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (t) => setTransactionMessageComputeUnitPrice(DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS, t),
      (t) => setTransactionMessageFeePayer(feePayer, t),
      (t) =>
        prependTransactionMessageInstruction(
          getSetComputeUnitLimitInstruction({ units: DEFAULT_COMPUTE_UNIT_LIMIT }),
          t,
        ),
      (t) => appendTransactionMessageInstructions([transferIx, memoIx], t),
      (t) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, t),
    );
    const signedTransaction = await partiallySignTransactionMessageWithSigners(tx);
    const base64EncodedWireTransaction = getBase64EncodedWireTransaction(signedTransaction);
    return {
      x402Version,
      payload: { transaction: base64EncodedWireTransaction },
    };
  }
}

/**
 * Leash-flavoured x402 Exact SVM facilitator scheme.
 *
 * Drop-in replacement for `@x402/svm`'s `ExactSvmScheme` (v2) and
 * `ExactSvmSchemeV1`. Adds two responsibilities on top of the upstream
 * verify pipeline:
 *
 *   1. **Recognise** the optional Leash protocol fee leg
 *      (`TransferChecked` to the treasury ATA) at instruction index 3
 *      so multi-leg buyer transactions don't get rejected as "unknown
 *      fourth instruction".
 *   2. **Enforce** that the fee leg matches what the seller advertised
 *      in `paymentRequirements.extra['leash.fee']` — same source ATA,
 *      same mint, same authority, destination = treasury ATA derived
 *      from `(authority, asset, tokenProgram)`, and amount =
 *      `ceil(amount * bps / 10_000)`.
 *
 * The verify logic mirrors the upstream `@x402/svm/exact/facilitator`
 * implementation byte-for-byte except for the optional-instructions
 * loop, which is widened to allow exactly one `TransferChecked` to the
 * configured treasury ATA. Settlement / signing / simulation / signer
 * management all delegate to the upstream `ExactSvmScheme` so we keep
 * the upstream settlement-cache, fee-payer rotation, RPC fan-out, and
 * `getExtra()` behaviour intact.
 *
 * Three operating modes (set per network via env — see
 * {@link resolveLeashFeeEnforcement} in `@leashmarket/core`):
 *
 *   - `off`     → behave exactly like upstream. Even if the seller
 *                 stamps a fee block we ignore it. Tests / local dev only.
 *   - `warn`    → if fee block is missing, accept (compatibility).
 *                 If fee block is present but the on-chain transaction
 *                 is malformed, log + accept anyway. Use during the
 *                 rollout window.
 *   - `enforce` → fee block MUST be present in `paymentRequirements`
 *                 (otherwise reject `leash_fee_required`) and the on-chain
 *                 transaction MUST contain a matching fee leg
 *                 (otherwise reject `leash_fee_invalid_*`).
 */

import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import {
  parseTransferCheckedInstruction as parseTransferCheckedToken,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferCheckedInstruction as parseTransferCheckedToken2022,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  address as toAddress,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  type Instruction,
} from '@solana/kit';
import {
  computeFeeAtoms,
  parseLeashFeeExtra,
  resolveLeashFeeAuthority,
  resolveLeashFeeBps,
  resolveLeashFeeEnforcement,
  type LeashFeeEnforcement,
  type LeashFeeExtra,
} from '@leashmarket/core';
import {
  decodeTransactionFromPayload,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  MEMO_PROGRAM_ADDRESS,
  SettlementCache,
  type FacilitatorSvmSigner,
} from '@x402/svm';
import { ExactSvmScheme } from '@x402/svm/exact/facilitator';
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';

import { networkFromCaip2ToTokenNetwork } from './util.js';

/**
 * The compute-budget instruction discriminators used by upstream:
 *   - `0x02` = `SetComputeUnitLimit`
 *   - `0x03` = `SetComputeUnitPrice`
 * Anything else in the leading two slots is rejected.
 */
const COMPUTE_LIMIT_DISCRIMINATOR = 2 as const;
const COMPUTE_PRICE_DISCRIMINATOR = 3 as const;

/** Hard cap on `instructions.length`: 2 compute + up to 2 ATA creates + 2 transfers + 2 optional. */
const MIN_INSTRUCTIONS = 3;
const MAX_INSTRUCTIONS = 8;

/**
 * VerifyResponse builder. Centralised so we never accidentally forget
 * the `payer: ''` shape upstream expects on early-exit failures.
 */
function fail(reason: string, payer = ''): VerifyResponse {
  return { isValid: false, invalidReason: reason, payer };
}

/**
 * Settle response builder for early-exit failures (mirrors upstream
 * shape, including `transaction: ''`).
 */
function settleFail(args: {
  network: PaymentRequirements['network'];
  reason: string;
  payer?: string;
}): SettleResponse {
  return {
    success: false,
    network: args.network,
    transaction: '',
    errorReason: args.reason,
    payer: args.payer ?? '',
  };
}

/**
 * Identify which token program a `TransferChecked` instruction belongs
 * to. Returns `null` if the program address isn't one of the SPL Token
 * variants (i.e. an unknown instruction).
 */
function tokenProgramKindOf(programAddress: string): 'spl-token' | 'spl-token-2022' | null {
  if (programAddress === TOKEN_PROGRAM_ADDRESS.toString()) return 'spl-token';
  if (programAddress === TOKEN_2022_PROGRAM_ADDRESS.toString()) return 'spl-token-2022';
  return null;
}

/**
 * Parse a `TransferChecked` instruction with whichever token program
 * codec matches its `programAddress`. Returns `null` if the program
 * doesn't match either SPL Token variant or the codec rejects the data.
 */
function parseTransferChecked(ix: Instruction): {
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amount: bigint;
  tokenProgram: 'spl-token' | 'spl-token-2022';
} | null {
  const programAddress = ix.programAddress.toString();
  const kind = tokenProgramKindOf(programAddress);
  if (!kind) return null;
  try {
    const parsed =
      kind === 'spl-token'
        ? parseTransferCheckedToken(ix as Parameters<typeof parseTransferCheckedToken>[0])
        : parseTransferCheckedToken2022(ix as Parameters<typeof parseTransferCheckedToken2022>[0]);
    return {
      source: parsed.accounts.source.address.toString(),
      mint: parsed.accounts.mint.address.toString(),
      destination: parsed.accounts.destination.address.toString(),
      authority: parsed.accounts.authority.address.toString(),
      amount: parsed.data.amount,
      tokenProgram: kind,
    };
  } catch {
    return null;
  }
}

export type LeashExactSvmFacilitatorOptions = {
  /** SVM signer (fee payer + simulator). Same shape upstream expects. */
  signer: FacilitatorSvmSigner;
  /**
   * Optional shared settlement cache. Pass the same instance to v1 +
   * v2 schemes so a single transaction can't double-settle by hopping
   * protocol versions.
   */
  settlementCache?: SettlementCache;
};

/**
 * Verify result for the optional fee leg sweep.
 *
 *   - `'no_block'`     → seller didn't advertise a fee. Fall through to
 *                        upstream's "optional ix must be Memo/Lighthouse"
 *                        rule (warn/off mode) or reject (enforce mode).
 *   - `'matched'`      → exactly one fee leg present, all fields match
 *                        the resolved expectation. Strip it from the
 *                        optional-instructions list before the Memo /
 *                        Lighthouse loop runs.
 *   - `'invalid'`      → fee block present but the on-chain shape is wrong
 *                        (mint mismatch, destination mismatch, amount
 *                        mismatch, authority mismatch, or duplicate fee
 *                        leg). Carries the specific `invalidReason`.
 */
type FeeLegSweep =
  | { kind: 'no_block' }
  | { kind: 'matched'; remaining: Instruction[] }
  | { kind: 'invalid'; reason: string };

/**
 * Sweep the optional instructions (`instructions.slice(3)`) looking for
 * exactly ONE `TransferChecked` whose `(source, mint, authority,
 * destination, amount)` matches the seller-advertised fee block. Returns
 * the optional-instruction list with the matched fee leg removed so the
 * caller can apply upstream's "everything else must be Memo or Lighthouse"
 * rule against the remainder.
 */
async function sweepFeeLeg(args: {
  optionalInstructions: Instruction[];
  feeBlock: LeashFeeExtra;
  expectedSource: string;
  expectedAuthority: string;
  expectedMint: string;
  expectedTokenProgram: 'spl-token' | 'spl-token-2022';
  expectedAmount: bigint;
  expectedDestination: string;
}): Promise<FeeLegSweep> {
  let matchedIndex = -1;
  for (let i = 0; i < args.optionalInstructions.length; i += 1) {
    const ix = args.optionalInstructions[i]!;
    const programAddress = ix.programAddress.toString();
    if (programAddress === LIGHTHOUSE_PROGRAM_ADDRESS || programAddress === MEMO_PROGRAM_ADDRESS) {
      continue;
    }
    const parsed = parseTransferChecked(ix);
    if (!parsed) {
      // Not a TransferChecked at all — leave it for the upstream loop
      // to reject as `invalid_exact_svm_payload_unknown_*`.
      continue;
    }
    // Looks like a candidate fee leg. Validate every field; mismatches
    // are surfaced as specific reasons so operators can debug from the
    // facilitator logs without re-deriving the expected values.
    if (parsed.tokenProgram !== args.expectedTokenProgram) {
      return { kind: 'invalid', reason: 'leash_fee_invalid_token_program' };
    }
    if (parsed.mint !== args.expectedMint) {
      return { kind: 'invalid', reason: 'leash_fee_invalid_mint' };
    }
    if (parsed.source !== args.expectedSource) {
      return { kind: 'invalid', reason: 'leash_fee_invalid_source' };
    }
    if (parsed.authority !== args.expectedAuthority) {
      return { kind: 'invalid', reason: 'leash_fee_invalid_authority' };
    }
    if (parsed.destination !== args.expectedDestination) {
      return { kind: 'invalid', reason: 'leash_fee_invalid_destination' };
    }
    if (parsed.amount !== args.expectedAmount) {
      return { kind: 'invalid', reason: 'leash_fee_invalid_amount' };
    }
    if (matchedIndex !== -1) {
      // Two fee legs in one transaction = always invalid; the buyer
      // shouldn't double-tip the treasury.
      return { kind: 'invalid', reason: 'leash_fee_duplicate' };
    }
    matchedIndex = i;
  }
  if (matchedIndex === -1) {
    // Block was advertised but no leg present.
    return { kind: 'invalid', reason: 'leash_fee_missing' };
  }
  // Hide the matched leg so the upstream Memo/Lighthouse loop only
  // sees instructions it understands.
  const remaining = args.optionalInstructions.filter((_ix, i) => i !== matchedIndex);
  return { kind: 'matched', remaining };
}

/**
 * Verify the leading two compute-budget instructions are exactly the
 * shape upstream expects:
 *   - ix[0] = `SetComputeUnitLimit` (`compute_budget` program, disc=2)
 *   - ix[1] = `SetComputeUnitPrice` (`compute_budget` program, disc=3)
 *     with `microLamports <= MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS` so a
 *     malicious buyer can't drain the facilitator's SOL balance with a
 *     huge priority fee.
 *
 * Throws `Error(invalidReason)` on any mismatch so the caller can
 * funnel it into a `VerifyResponse`.
 */
function assertComputeBudgetPair(instructions: Instruction[]): void {
  const limitIx = instructions[0];
  const priceIx = instructions[1];
  if (!limitIx || !priceIx) {
    throw new Error('invalid_exact_svm_payload_transaction_instructions_length');
  }
  const limitProgram = limitIx.programAddress.toString();
  if (
    limitProgram !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !limitIx.data ||
    limitIx.data[0] !== COMPUTE_LIMIT_DISCRIMINATOR
  ) {
    throw new Error('invalid_exact_svm_payload_transaction_instructions_compute_limit_instruction');
  }
  try {
    parseSetComputeUnitLimitInstruction(
      limitIx as Parameters<typeof parseSetComputeUnitLimitInstruction>[0],
    );
  } catch {
    throw new Error('invalid_exact_svm_payload_transaction_instructions_compute_limit_instruction');
  }
  const priceProgram = priceIx.programAddress.toString();
  if (
    priceProgram !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !priceIx.data ||
    priceIx.data[0] !== COMPUTE_PRICE_DISCRIMINATOR
  ) {
    throw new Error('invalid_exact_svm_payload_transaction_instructions_compute_price_instruction');
  }
  try {
    const parsed = parseSetComputeUnitPriceInstruction(
      priceIx as Parameters<typeof parseSetComputeUnitPriceInstruction>[0],
    );
    if (parsed.data.microLamports > BigInt(MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS)) {
      throw new Error(
        'invalid_exact_svm_payload_transaction_instructions_compute_price_instruction_too_high',
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('too_high')) throw e;
    throw new Error('invalid_exact_svm_payload_transaction_instructions_compute_price_instruction');
  }
}

/**
 * Drop-in replacement for `@x402/svm`'s `ExactSvmScheme` that adds
 * Leash protocol fee verification.
 */
export class LeashExactSvmFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = 'exact';
  readonly caipFamily = 'solana:*';

  /** Upstream scheme instance — used for `getExtra` / `getSigners` / `settle` (after we've already verified the fee leg). */
  private readonly upstream: ExactSvmScheme;
  private readonly signer: FacilitatorSvmSigner;
  private readonly settlementCache: SettlementCache;

  constructor(opts: LeashExactSvmFacilitatorOptions) {
    this.signer = opts.signer;
    this.settlementCache = opts.settlementCache ?? new SettlementCache();
    // Hand the same settlement cache to upstream so settle()'s
    // duplicate-detection covers both verify+settle paths.
    this.upstream = new ExactSvmScheme(opts.signer, this.settlementCache);
  }

  getExtra(network: string): Record<string, unknown> | undefined {
    return this.upstream.getExtra(network);
  }

  getSigners(network: string): string[] {
    return this.upstream.getSigners(network);
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const exactSvmPayload = payload.payload as { transaction: string };
    if (payload.accepted.scheme !== 'exact' || requirements.scheme !== 'exact') {
      return fail('unsupported_scheme');
    }
    if (payload.accepted.network !== requirements.network) {
      return fail('network_mismatch');
    }
    if (
      typeof requirements.extra?.feePayer !== 'string' ||
      requirements.extra.feePayer.length === 0
    ) {
      return fail('invalid_exact_svm_payload_missing_fee_payer');
    }
    const signerAddresses = this.signer.getAddresses().map((a) => a.toString());
    if (!signerAddresses.includes(requirements.extra.feePayer as string)) {
      return fail('fee_payer_not_managed_by_facilitator');
    }

    let transaction;
    try {
      transaction = decodeTransactionFromPayload(exactSvmPayload);
    } catch {
      return fail('invalid_exact_svm_payload_transaction_could_not_be_decoded');
    }
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const decompiled = decompileTransactionMessage(compiled);
    const instructions = (decompiled.instructions ?? []) as Instruction[];
    if (instructions.length < MIN_INSTRUCTIONS || instructions.length > MAX_INSTRUCTIONS) {
      return fail('invalid_exact_svm_payload_transaction_instructions_length');
    }

    try {
      assertComputeBudgetPair(instructions);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }

    // The buyer may prepend up to two idempotent associated-token-account
    // creates (seller `payTo` ATA + fee vault ATA) before the seller leg
    // so first-time settlements on fresh mints succeed without an
    // out-of-band ATA-init. We walk past them and validate each below.
    let sellerIdx = 2;
    const ataCreates: ReturnType<typeof parseCreateAssociatedTokenIdempotentInstruction>[] = [];
    while (sellerIdx < instructions.length && sellerIdx <= 4) {
      const ix = instructions[sellerIdx]!;
      if (ix.programAddress.toString() !== ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString()) {
        break;
      }
      let parsed: ReturnType<typeof parseCreateAssociatedTokenIdempotentInstruction>;
      try {
        parsed = parseCreateAssociatedTokenIdempotentInstruction(
          ix as Parameters<typeof parseCreateAssociatedTokenIdempotentInstruction>[0],
        );
      } catch {
        return fail('invalid_exact_svm_payload_unexpected_ata_create');
      }
      ataCreates.push(parsed);
      sellerIdx += 1;
    }
    const sellerIxRaw = instructions[sellerIdx];
    if (!sellerIxRaw) {
      return fail('invalid_exact_svm_payload_no_transfer_instruction');
    }
    const sellerLeg = parseTransferChecked(sellerIxRaw);
    if (!sellerLeg) {
      return fail('invalid_exact_svm_payload_no_transfer_instruction');
    }
    const payer = sellerLeg.authority;
    if (signerAddresses.includes(payer)) {
      return fail('invalid_exact_svm_payload_transaction_fee_payer_transferring_funds', payer);
    }
    if (sellerLeg.mint !== requirements.asset) {
      return fail('invalid_exact_svm_payload_mint_mismatch', payer);
    }

    // Verify the seller leg destination = ATA(payTo, asset, tokenProgram).
    const tokenProgramAddress =
      sellerLeg.tokenProgram === 'spl-token-2022'
        ? TOKEN_2022_PROGRAM_ADDRESS
        : TOKEN_PROGRAM_ADDRESS;
    try {
      const [expectedDestATA] = await findAssociatedTokenPda({
        mint: toAddress(requirements.asset as string),
        owner: toAddress(requirements.payTo as string),
        tokenProgram: tokenProgramAddress,
      });
      if (sellerLeg.destination !== expectedDestATA.toString()) {
        return fail('invalid_exact_svm_payload_recipient_mismatch', payer);
      }
    } catch {
      return fail('invalid_exact_svm_payload_recipient_mismatch', payer);
    }
    if (sellerLeg.amount !== BigInt(requirements.amount)) {
      return fail('invalid_exact_svm_payload_amount_mismatch', payer);
    }

    // ---- Leash fee enforcement ----
    const tokenNetwork = networkFromCaip2ToTokenNetwork(requirements.network);
    const enforcement: LeashFeeEnforcement = tokenNetwork
      ? resolveLeashFeeEnforcement(tokenNetwork)
      : 'off';
    const feeBlock = parseLeashFeeExtra(
      (requirements.extra ?? null) as Record<string, unknown> | null,
    );

    // Validate every leading idempotent ATA-create the buyer prepended.
    // The only legal targets are the seller `payTo` ATA and (when a fee
    // block is present) the protocol fee vault ATA, both for the same
    // `(asset, tokenProgram)` we just verified on the seller leg. Each
    // create must be paid by the configured `feePayer` so the buyer
    // cannot bill a third-party wallet for rent.
    if (ataCreates.length > 0) {
      const feePayerStr = requirements.extra.feePayer as string;
      const expectedTp =
        sellerLeg.tokenProgram === 'spl-token-2022'
          ? TOKEN_2022_PROGRAM_ADDRESS.toString()
          : TOKEN_PROGRAM_ADDRESS.toString();
      const allowed: Array<{ ata: string; owner: string }> = [
        { ata: sellerLeg.destination, owner: requirements.payTo as string },
      ];
      if (feeBlock) {
        const serverAuthorityPreview = tokenNetwork
          ? resolveLeashFeeAuthority(tokenNetwork)
          : feeBlock.feeAuthority;
        try {
          const [ata] = await findAssociatedTokenPda({
            mint: toAddress(requirements.asset as string),
            owner: toAddress(serverAuthorityPreview),
            tokenProgram: tokenProgramAddress,
          });
          allowed.push({ ata: ata.toString(), owner: serverAuthorityPreview });
        } catch {
          return fail('leash_fee_destination_unresolvable', payer);
        }
      }
      const seen = new Set<string>();
      for (const parsedCreate of ataCreates) {
        if (
          parsedCreate.programAddress.toString() !== ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString()
        ) {
          return fail('invalid_exact_svm_payload_unexpected_ata_create', payer);
        }
        if (parsedCreate.accounts.payer.address.toString() !== feePayerStr) {
          return fail('invalid_exact_svm_payload_unexpected_ata_create', payer);
        }
        if (parsedCreate.accounts.mint.address.toString() !== (requirements.asset as string)) {
          return fail('invalid_exact_svm_payload_unexpected_ata_create', payer);
        }
        if (parsedCreate.accounts.tokenProgram.address.toString() !== expectedTp) {
          return fail('invalid_exact_svm_payload_unexpected_ata_create', payer);
        }
        const ataStr = parsedCreate.accounts.ata.address.toString();
        const ownerStr = parsedCreate.accounts.owner.address.toString();
        const match = allowed.find((a) => a.ata === ataStr && a.owner === ownerStr);
        if (!match) {
          return fail('invalid_exact_svm_payload_unexpected_ata_create', payer);
        }
        if (seen.has(ataStr)) {
          return fail('invalid_exact_svm_payload_unexpected_ata_create', payer);
        }
        seen.add(ataStr);
      }
    }

    const optionalInstructions = instructions.slice(sellerIdx + 1) as Instruction[];
    let leftoverOptional: Instruction[] = optionalInstructions;

    if (enforcement === 'enforce' && !feeBlock) {
      // In enforce mode the seller MUST advertise a fee block. Reject
      // up front so the buyer's SDK gets a clear signal to upgrade
      // rather than a generic "unknown fourth instruction" later.
      return fail('leash_fee_required', payer);
    }

    if (enforcement !== 'off' && feeBlock) {
      // Treasury authority + bps must come from server config, not from
      // the wire — `extra.feeAuthority` is what the seller said they're
      // collecting for. We override with the env-pinned value so a
      // misconfigured seller (or a hostile one) can't redirect fees.
      const serverAuthority = tokenNetwork
        ? resolveLeashFeeAuthority(tokenNetwork)
        : feeBlock.feeAuthority;
      if (feeBlock.feeAuthority !== serverAuthority) {
        if (enforcement === 'enforce') {
          return fail('leash_fee_authority_mismatch', payer);
        }
        // warn-mode: log + accept the seller's chosen authority anyway.
        console.warn(
          `[leash-facilitator] fee authority mismatch on ${requirements.network}: ` +
            `seller=${feeBlock.feeAuthority} server=${serverAuthority} (warn mode)`,
        );
      }
      // Always derive expected destination + amount from server config
      // so we never trust buyer-supplied values for either field.
      const serverBps = tokenNetwork ? resolveLeashFeeBps() : feeBlock.bps;
      if (feeBlock.bps !== serverBps && enforcement === 'enforce') {
        return fail('leash_fee_bps_mismatch', payer);
      }
      const expectedFeeAmount = computeFeeAtoms(BigInt(requirements.amount), serverBps);
      let expectedFeeDestination: string;
      try {
        const [ata] = await findAssociatedTokenPda({
          mint: toAddress(requirements.asset as string),
          owner: toAddress(serverAuthority),
          tokenProgram: tokenProgramAddress,
        });
        expectedFeeDestination = ata.toString();
      } catch {
        return fail('leash_fee_destination_unresolvable', payer);
      }

      const sweep = await sweepFeeLeg({
        optionalInstructions,
        feeBlock,
        expectedSource: sellerLeg.source,
        expectedAuthority: payer,
        expectedMint: requirements.asset as string,
        expectedTokenProgram: sellerLeg.tokenProgram,
        expectedAmount: expectedFeeAmount,
        expectedDestination: expectedFeeDestination,
      });

      if (sweep.kind === 'matched') {
        leftoverOptional = sweep.remaining;
      } else if (sweep.kind === 'invalid') {
        if (enforcement === 'enforce') {
          return fail(sweep.reason, payer);
        }
        // warn-mode: log so operators can see fee shortfalls accumulating
        // in metrics, but still accept the payment so no buyer is
        // turned away during the rollout window.
        console.warn(
          `[leash-facilitator] fee leg rejected on ${requirements.network}: ` +
            `${sweep.reason} (warn mode — accepting anyway)`,
        );
      }
    }

    // Apply the upstream "every leftover optional ix must be Memo or
    // Lighthouse" rule.
    const invalidReasonByIndex = [
      'invalid_exact_svm_payload_unknown_fourth_instruction',
      'invalid_exact_svm_payload_unknown_fifth_instruction',
      'invalid_exact_svm_payload_unknown_sixth_instruction',
    ];
    for (let i = 0; i < leftoverOptional.length; i += 1) {
      const programAddress = leftoverOptional[i]!.programAddress.toString();
      if (
        programAddress === LIGHTHOUSE_PROGRAM_ADDRESS ||
        programAddress === MEMO_PROGRAM_ADDRESS
      ) {
        continue;
      }
      return fail(
        invalidReasonByIndex[i] ?? 'invalid_exact_svm_payload_unknown_optional_instruction',
        payer,
      );
    }

    // Memo verification mirrors upstream: if the seller asked for a
    // memo, exactly one Memo instruction must be present in the
    // ORIGINAL optional list (not the post-sweep remainder, since
    // upstream allows the memo to live alongside Lighthouse legs).
    const expectedMemo = (requirements.extra as Record<string, unknown> | null | undefined)?.memo;
    if (typeof expectedMemo === 'string' && expectedMemo.length > 0) {
      const memoInstructions = optionalInstructions.filter(
        (ix) => ix.programAddress.toString() === MEMO_PROGRAM_ADDRESS,
      );
      if (memoInstructions.length !== 1) {
        return fail('invalid_exact_svm_payload_memo_count', payer);
      }
      const memoData = memoInstructions[0]!.data;
      const actualMemo = memoData ? new TextDecoder().decode(new Uint8Array(memoData)) : '';
      if (actualMemo !== expectedMemo) {
        return fail('invalid_exact_svm_payload_memo_mismatch', payer);
      }
    }

    // Final gate: simulate as the configured fee payer to surface
    // RPC-level rejections (insufficient balance, blockhash expired,
    // etc.) as a verify failure rather than a settle failure.
    try {
      const feePayer = toAddress(requirements.extra.feePayer as string);
      const fullySigned = await this.signer.signTransaction(
        exactSvmPayload.transaction,
        feePayer,
        requirements.network,
      );
      await this.signer.simulateTransaction(fullySigned, requirements.network);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isValid: false,
        invalidReason: 'transaction_simulation_failed',
        invalidMessage: message,
        payer,
      };
    }

    return { isValid: true, invalidReason: undefined, payer };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const exactSvmPayload = payload.payload as { transaction: string };
    const valid = await this.verify(payload, requirements);
    if (!valid.isValid) {
      return settleFail({
        network: payload.accepted.network,
        reason: valid.invalidReason ?? 'verification_failed',
        payer: valid.payer ?? '',
      });
    }
    const txKey = exactSvmPayload.transaction;
    if (this.settlementCache.isDuplicate(txKey)) {
      return settleFail({
        network: payload.accepted.network,
        reason: 'duplicate_settlement',
        payer: valid.payer ?? '',
      });
    }
    try {
      const feePayer = toAddress(requirements.extra!.feePayer as string);
      const fullySigned = await this.signer.signTransaction(
        exactSvmPayload.transaction,
        feePayer,
        requirements.network,
      );
      const signature = await this.signer.sendTransaction(fullySigned, requirements.network);
      await this.signer.confirmTransaction(signature, requirements.network);
      return {
        success: true,
        transaction: signature,
        network: payload.accepted.network,
        payer: valid.payer ?? '',
      };
    } catch (error) {
      console.error('[leash-facilitator] settle failed:', error);
      return settleFail({
        network: payload.accepted.network,
        reason: 'transaction_failed',
        payer: valid.payer ?? '',
      });
    }
  }
}

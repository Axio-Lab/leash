/**
 * V1 protocol counterpart of {@link LeashExactSvmFacilitator}.
 *
 * x402 v1 payloads use a flat shape (`payload.scheme`, `payload.network`)
 * and quote the seller leg via `requirements.maxAmountRequired` instead
 * of `requirements.amount`. Behaviour is otherwise identical to the v2
 * facilitator: same compute-budget checks, same seller-leg validation,
 * same Leash fee enforcement, same Memo + Lighthouse rules.
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
} from '@leash/core';
import {
  decodeTransactionFromPayload,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  MEMO_PROGRAM_ADDRESS,
  SettlementCache,
  type FacilitatorSvmSigner,
} from '@x402/svm';
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';

import { networkFromCaip2ToTokenNetwork } from './util.js';

const COMPUTE_LIMIT_DISC = 2 as const;
const COMPUTE_PRICE_DISC = 3 as const;
const MIN_INSTRUCTIONS = 3;
const MAX_INSTRUCTIONS = 8;

function fail(reason: string, payer = ''): VerifyResponse {
  return { isValid: false, invalidReason: reason, payer };
}

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

function tokenProgramKindOf(programAddress: string): 'spl-token' | 'spl-token-2022' | null {
  if (programAddress === TOKEN_PROGRAM_ADDRESS.toString()) return 'spl-token';
  if (programAddress === TOKEN_2022_PROGRAM_ADDRESS.toString()) return 'spl-token-2022';
  return null;
}

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

type FeeLegSweep =
  | { kind: 'no_block' }
  | { kind: 'matched'; remaining: Instruction[] }
  | { kind: 'invalid'; reason: string };

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
    if (!parsed) continue;
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
      return { kind: 'invalid', reason: 'leash_fee_duplicate' };
    }
    matchedIndex = i;
  }
  if (matchedIndex === -1) {
    return { kind: 'invalid', reason: 'leash_fee_missing' };
  }
  return {
    kind: 'matched',
    remaining: args.optionalInstructions.filter((_, i) => i !== matchedIndex),
  };
}

function assertComputeBudgetPair(instructions: Instruction[]): void {
  const limitIx = instructions[0];
  const priceIx = instructions[1];
  if (!limitIx || !priceIx) {
    throw new Error('invalid_exact_svm_payload_transaction_instructions_length');
  }
  if (
    limitIx.programAddress.toString() !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !limitIx.data ||
    limitIx.data[0] !== COMPUTE_LIMIT_DISC
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
  if (
    priceIx.programAddress.toString() !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !priceIx.data ||
    priceIx.data[0] !== COMPUTE_PRICE_DISC
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

export type LeashExactSvmFacilitatorV1Options = {
  signer: FacilitatorSvmSigner;
  settlementCache?: SettlementCache;
};

/**
 * V1 wire-shape facilitator. Same enforcement modes as the v2 scheme,
 * see {@link LeashExactSvmFacilitator}.
 */
export class LeashExactSvmFacilitatorV1 implements SchemeNetworkFacilitator {
  readonly scheme = 'exact';
  readonly caipFamily = 'solana:*';

  private readonly signer: FacilitatorSvmSigner;
  private readonly settlementCache: SettlementCache;

  constructor(opts: LeashExactSvmFacilitatorV1Options) {
    this.signer = opts.signer;
    this.settlementCache = opts.settlementCache ?? new SettlementCache();
  }

  getExtra(_network: string): Record<string, unknown> | undefined {
    const addresses = this.signer.getAddresses();
    if (addresses.length === 0) return undefined;
    const idx = Math.floor(Math.random() * addresses.length);
    return { feePayer: addresses[idx] };
  }

  getSigners(_network: string): string[] {
    return this.signer.getAddresses().map((a) => a.toString());
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // V1 uses the legacy flat shape on the wire — both payload + reqs
    // carry `scheme` / `network` at the top level (not under `accepted`).
    const payloadV1 = payload as unknown as {
      scheme?: string;
      network?: string;
      payload: { transaction: string };
    };
    const requirementsV1 = requirements as unknown as PaymentRequirements & {
      maxAmountRequired: string;
    };
    const exactSvmPayload = payloadV1.payload;

    if (payloadV1.scheme !== 'exact' || requirements.scheme !== 'exact') {
      return fail('unsupported_scheme');
    }
    if (payloadV1.network !== requirements.network) {
      return fail('network_mismatch');
    }
    if (
      typeof requirementsV1.extra?.feePayer !== 'string' ||
      requirementsV1.extra.feePayer.length === 0
    ) {
      return fail('invalid_exact_svm_payload_missing_fee_payer');
    }
    const signerAddresses = this.signer.getAddresses().map((a) => a.toString());
    if (!signerAddresses.includes(requirementsV1.extra.feePayer as string)) {
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
    if (sellerLeg.amount !== BigInt(requirementsV1.maxAmountRequired)) {
      return fail('invalid_exact_svm_payload_amount_mismatch', payer);
    }

    const tokenNetwork = networkFromCaip2ToTokenNetwork(requirements.network);
    const enforcement: LeashFeeEnforcement = tokenNetwork
      ? resolveLeashFeeEnforcement(tokenNetwork)
      : 'off';
    const feeBlock = parseLeashFeeExtra(
      (requirementsV1.extra ?? null) as Record<string, unknown> | null,
    );

    if (ataCreates.length > 0) {
      const feePayerStr = requirementsV1.extra.feePayer as string;
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
      return fail('leash_fee_required', payer);
    }

    if (enforcement !== 'off' && feeBlock) {
      const serverAuthority = tokenNetwork
        ? resolveLeashFeeAuthority(tokenNetwork)
        : feeBlock.feeAuthority;
      if (feeBlock.feeAuthority !== serverAuthority) {
        if (enforcement === 'enforce') return fail('leash_fee_authority_mismatch', payer);
        console.warn(
          `[leash-facilitator-v1] fee authority mismatch on ${requirements.network}: ` +
            `seller=${feeBlock.feeAuthority} server=${serverAuthority} (warn)`,
        );
      }
      const serverBps = tokenNetwork ? resolveLeashFeeBps() : feeBlock.bps;
      if (feeBlock.bps !== serverBps && enforcement === 'enforce') {
        return fail('leash_fee_bps_mismatch', payer);
      }
      const expectedFeeAmount = computeFeeAtoms(
        BigInt(requirementsV1.maxAmountRequired),
        serverBps,
      );
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
        if (enforcement === 'enforce') return fail(sweep.reason, payer);
        console.warn(
          `[leash-facilitator-v1] fee leg rejected on ${requirements.network}: ` +
            `${sweep.reason} (warn)`,
        );
      }
    }

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

    const expectedMemo = (requirementsV1.extra as Record<string, unknown> | null | undefined)?.memo;
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

    try {
      const feePayer = toAddress(requirementsV1.extra.feePayer as string);
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
    const payloadV1 = payload as unknown as {
      network: PaymentRequirements['network'];
      payload: { transaction: string };
    };
    const exactSvmPayload = payloadV1.payload;
    const valid = await this.verify(payload, requirements);
    if (!valid.isValid) {
      return settleFail({
        network: payloadV1.network,
        reason: valid.invalidReason ?? 'verification_failed',
        payer: valid.payer ?? '',
      });
    }
    const txKey = exactSvmPayload.transaction;
    if (this.settlementCache.isDuplicate(txKey)) {
      return settleFail({
        network: payloadV1.network,
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
        network: payloadV1.network,
        payer: valid.payer ?? '',
      };
    } catch (error) {
      console.error('[leash-facilitator-v1] settle failed:', error);
      return settleFail({
        network: payloadV1.network,
        reason: 'transaction_failed',
        payer: valid.payer ?? '',
      });
    }
  }
}

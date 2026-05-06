/**
 * POST /mpp/settle — verify a buyer-signed SPL transfer matches an
 * {@link MppChallengeV1}, co-sign as fee payer, simulate, broadcast.
 *
 * Wire contract matches {@link createMppFacilitatorClient} in seller-kit.
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
import { MppChallengeV1Schema } from '@leashmarket/schemas';
import {
  decodeTransactionFromPayload,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  MEMO_PROGRAM_ADDRESS,
  SettlementCache,
  type FacilitatorSvmSigner,
} from '@x402/svm';

import { mppNetworkToCaip2 } from './network.js';

const COMPUTE_LIMIT_DISC = 2 as const;
const COMPUTE_PRICE_DISC = 3 as const;
/** 2× compute-budget + [`0..1` idempotent ATA] + transfer + memo. */
const MIN_INSTRUCTIONS = 4;
const MAX_INSTRUCTIONS = 6;

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

function assertComputeBudgetPair(instructions: Instruction[]): void {
  const limitIx = instructions[0];
  const priceIx = instructions[1];
  if (!limitIx || !priceIx) {
    throw new Error('mpp_invalid_compute_budget_pair');
  }
  if (
    limitIx.programAddress.toString() !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !limitIx.data ||
    limitIx.data[0] !== COMPUTE_LIMIT_DISC
  ) {
    throw new Error('mpp_invalid_compute_limit');
  }
  try {
    parseSetComputeUnitLimitInstruction(
      limitIx as Parameters<typeof parseSetComputeUnitLimitInstruction>[0],
    );
  } catch {
    throw new Error('mpp_invalid_compute_limit');
  }
  if (
    priceIx.programAddress.toString() !== COMPUTE_BUDGET_PROGRAM_ADDRESS.toString() ||
    !priceIx.data ||
    priceIx.data[0] !== COMPUTE_PRICE_DISC
  ) {
    throw new Error('mpp_invalid_compute_price');
  }
  try {
    const parsed = parseSetComputeUnitPriceInstruction(
      priceIx as Parameters<typeof parseSetComputeUnitPriceInstruction>[0],
    );
    if (parsed.data.microLamports > BigInt(MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS)) {
      throw new Error('mpp_compute_price_too_high');
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'mpp_compute_price_too_high') throw e;
    throw new Error('mpp_invalid_compute_price');
  }
}

export type MppSettleHandlerOptions = {
  signer: FacilitatorSvmSigner;
  /** CAIP-2 networks this facilitator operates on (from factory). */
  allowedCaip2Networks: ReadonlySet<string>;
  settlementCache?: SettlementCache;
};

export type MppSettleResultJson =
  | { success: true; transaction: string; slot: string | number }
  | { success: false; error: string; transaction?: string };

/**
 * Parse + verify + settle. Returns JSON body for HTTP (always 200 from
 * handler — caller maps errors to 4xx when desired; we use 200 + success:false
 * to mirror seller-kit client which checks `success` and HTTP status together).
 */
export async function mppSettleFromPostBody(
  body: unknown,
  opts: MppSettleHandlerOptions,
): Promise<{ httpStatus: number; json: MppSettleResultJson }> {
  const cache = opts.settlementCache ?? new SettlementCache();

  if (!body || typeof body !== 'object') {
    return { httpStatus: 400, json: { success: false, error: 'mpp_invalid_json' } };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.signedTx !== 'string' || b.signedTx.length === 0) {
    return { httpStatus: 400, json: { success: false, error: 'mpp_missing_signed_tx' } };
  }

  let challenge;
  try {
    challenge = MppChallengeV1Schema.parse(b.challenge);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { httpStatus: 400, json: { success: false, error: `mpp_invalid_challenge: ${msg}` } };
  }

  const caip2 = mppNetworkToCaip2(challenge.request.network);
  if (!caip2) {
    return { httpStatus: 400, json: { success: false, error: 'mpp_unknown_network' } };
  }
  if (!opts.allowedCaip2Networks.has(caip2)) {
    return { httpStatus: 400, json: { success: false, error: 'mpp_network_not_enabled' } };
  }

  const feePayerExpected = challenge.request.feePayer;
  if (!feePayerExpected || feePayerExpected.length === 0) {
    return { httpStatus: 400, json: { success: false, error: 'mpp_fee_payer_required' } };
  }
  const signerAddresses = opts.signer.getAddresses().map((a) => a.toString());
  if (!signerAddresses.includes(feePayerExpected)) {
    return { httpStatus: 422, json: { success: false, error: 'mpp_fee_payer_not_managed' } };
  }

  let verifyError: string | null = null;
  try {
    verifyError = await verifyMppTx({
      signedTxBase64: b.signedTx,
      challenge,
      feePayerExpected,
      signerAddresses,
    });
  } catch (e) {
    verifyError = e instanceof Error ? e.message : String(e);
  }
  if (verifyError) {
    return { httpStatus: 422, json: { success: false, error: verifyError } };
  }

  if (cache.isDuplicate(b.signedTx)) {
    return { httpStatus: 422, json: { success: false, error: 'mpp_duplicate_settlement' } };
  }

  try {
    const feePayer = toAddress(feePayerExpected);
    const fullySigned = await opts.signer.signTransaction(b.signedTx, feePayer, caip2);
    await opts.signer.simulateTransaction(fullySigned, caip2);
    const signature = await opts.signer.sendTransaction(fullySigned, caip2);
    await opts.signer.confirmTransaction(signature, caip2);
    return { httpStatus: 200, json: { success: true, transaction: signature, slot: 0 } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { httpStatus: 422, json: { success: false, error: `mpp_settle_failed: ${message}` } };
  }
}

async function verifyMppTx(args: {
  signedTxBase64: string;
  challenge: ReturnType<typeof MppChallengeV1Schema.parse>;
  feePayerExpected: string;
  signerAddresses: string[];
}): Promise<string | null> {
  let transaction;
  try {
    transaction = decodeTransactionFromPayload({ transaction: args.signedTxBase64 });
  } catch {
    return 'mpp_tx_decode_failed';
  }
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const decompiled = decompileTransactionMessage(compiled);
  const instructions = (decompiled.instructions ?? []) as Instruction[];

  const msgFeePayer = readFeePayerFromMessage(decompiled);
  if (!msgFeePayer || msgFeePayer !== args.feePayerExpected) {
    return 'mpp_fee_payer_mismatch';
  }

  if (instructions.length < MIN_INSTRUCTIONS || instructions.length > MAX_INSTRUCTIONS) {
    return 'mpp_instruction_count';
  }
  try {
    assertComputeBudgetPair(instructions);
  } catch (e) {
    return e instanceof Error ? e.message : 'mpp_compute_budget';
  }

  let idx = 2;
  const ataCreates: ReturnType<typeof parseCreateAssociatedTokenIdempotentInstruction>[] = [];
  while (idx < instructions.length && idx <= 4) {
    const ix = instructions[idx]!;
    if (ix.programAddress.toString() !== ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString()) break;
    try {
      ataCreates.push(
        parseCreateAssociatedTokenIdempotentInstruction(
          ix as Parameters<typeof parseCreateAssociatedTokenIdempotentInstruction>[0],
        ),
      );
    } catch {
      return 'mpp_bad_ata_create';
    }
    idx += 1;
  }

  const transferIx = instructions[idx];
  if (!transferIx) return 'mpp_missing_transfer';
  const sellerLeg = parseTransferChecked(transferIx);
  if (!sellerLeg) return 'mpp_missing_transfer';

  if (args.signerAddresses.includes(sellerLeg.authority)) {
    return 'mpp_facilitator_cannot_be_transfer_authority';
  }
  if (sellerLeg.mint !== args.challenge.request.asset) {
    return 'mpp_mint_mismatch';
  }
  if (sellerLeg.amount !== BigInt(args.challenge.request.amount)) {
    return 'mpp_amount_mismatch';
  }

  const tokenProgramAddress =
    sellerLeg.tokenProgram === 'spl-token-2022'
      ? TOKEN_2022_PROGRAM_ADDRESS
      : TOKEN_PROGRAM_ADDRESS;
  try {
    const [expectedDest] = await findAssociatedTokenPda({
      mint: toAddress(args.challenge.request.asset as string),
      owner: toAddress(args.challenge.request.recipient as string),
      tokenProgram: tokenProgramAddress,
    });
    if (sellerLeg.destination !== expectedDest.toString()) {
      return 'mpp_destination_mismatch';
    }
  } catch {
    return 'mpp_destination_mismatch';
  }

  for (const parsedCreate of ataCreates) {
    if (parsedCreate.accounts.payer.address.toString() !== args.feePayerExpected) {
      return 'mpp_ata_payer_mismatch';
    }
    if (parsedCreate.accounts.mint.address.toString() !== args.challenge.request.asset) {
      return 'mpp_ata_mint_mismatch';
    }
    const expectedTp =
      sellerLeg.tokenProgram === 'spl-token-2022'
        ? TOKEN_2022_PROGRAM_ADDRESS.toString()
        : TOKEN_PROGRAM_ADDRESS.toString();
    if (parsedCreate.accounts.tokenProgram.address.toString() !== expectedTp) {
      return 'mpp_ata_program_mismatch';
    }
    if (parsedCreate.accounts.ata.address.toString() !== sellerLeg.destination) {
      return 'mpp_ata_dest_mismatch';
    }
    if (parsedCreate.accounts.owner.address.toString() !== args.challenge.request.recipient) {
      return 'mpp_ata_owner_mismatch';
    }
  }

  const optional = instructions.slice(idx + 1) as Instruction[];
  const expectedMemo = `mpp:${args.challenge.challengeId}`;
  const memos = optional.filter((ix) => ix.programAddress.toString() === MEMO_PROGRAM_ADDRESS);
  if (memos.length !== 1) return 'mpp_memo_count';
  const memoData = memos[0]!.data;
  const actualMemo = memoData ? new TextDecoder().decode(new Uint8Array(memoData)) : '';
  if (actualMemo !== expectedMemo) return 'mpp_memo_mismatch';

  for (const ix of optional) {
    const p = ix.programAddress.toString();
    if (p === MEMO_PROGRAM_ADDRESS) continue;
    if (p === LIGHTHOUSE_PROGRAM_ADDRESS) return 'mpp_unknown_instruction';
    return 'mpp_unknown_instruction';
  }

  return null;
}

function readFeePayerFromMessage(
  decompiled: ReturnType<typeof decompileTransactionMessage>,
): string | null {
  const m = decompiled as { feePayer?: { address?: unknown } };
  const a = m.feePayer?.address;
  if (a === undefined || a === null) return null;
  return typeof a === 'string' ? a : String(a);
}

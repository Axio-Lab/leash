/**
 * Owner-driven SOL withdrawals from an agent's treasury (Asset Signer PDA).
 *
 * Agent token launches via Metaplex Genesis route **creator fees as
 * native SOL** to the asset signer PDA — the same PDA that holds the
 * SPL stables we already manage in `./withdraw.ts`. Without a SOL
 * withdraw path those fees are stuck on the PDA forever (the PDA is
 * owned by mpl-core, so a user wallet can't sign a System transfer on
 * its behalf directly).
 *
 * The fix is the same trick we use for SPL `Approve` / `TransferChecked`:
 * wrap a raw `SystemProgram::Transfer` instruction in `mpl-core::Execute`
 * with the asset signer PDA declared as the inner signer. mpl-core
 * rewrites the signer flag during CPI so the on-chain System program
 * sees a valid PDA-signed transfer.
 *
 * Why a raw instruction (not `mpl-toolbox::transferSol`)?
 *
 *   `transferSol` from mpl-toolbox expects `source: Signer` — i.e. a
 *   key the caller can sign with locally. The treasury PDA can only
 *   sign via mpl-core's `Execute` CPI, so we hand-roll the instruction
 *   layout (discriminator + amount) and let `Execute` rewrite the
 *   signer slot for us.
 *
 * Rent-exempt floor:
 *
 *   The treasury PDA holds nested token accounts (one per mint we
 *   provision) and may also hold raw lamports from creator fees. The
 *   System program rejects any transfer that would leave the PDA below
 *   its rent-exempt minimum. {@link withdrawTreasurySolAll} reads the
 *   on-chain balance, subtracts a configurable safety reserve, and
 *   never asks the chain to overdraw — the UI gets a clean
 *   `nothing to withdraw` instead of a cryptic
 *   `insufficient funds for rent` error.
 */

import { execute, findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import {
  publicKey,
  type Instruction,
  type PublicKey,
  type Signer,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

/** Solana System program — owner of every "naked SOL" account. */
export const SYSTEM_PROGRAM_ID = publicKey('11111111111111111111111111111111');

/**
 * Default safety reserve we leave behind when withdrawing "all" SOL from
 * the treasury PDA. The PDA itself doesn't pay rent (it's a derivation,
 * not a created account), but in practice we've seen RPCs return
 * `insufficient funds` when the post-transfer lamport count is too
 * close to zero on accounts that were funded as part of an `Execute`
 * trace. 5_000 lamports (~0.000005 SOL) is well under the cost of a tx
 * and removes the edge case entirely. Override via the `reserveLamports`
 * arg on {@link WithdrawTreasurySolAllArgs}.
 */
export const DEFAULT_SOL_RESERVE_LAMPORTS = 5_000n;

/** Encode a u64 LE for SystemProgram instructions. */
function encodeU64Le(amount: bigint): Uint8Array {
  if (amount < 0n) throw new Error('System u64 cannot be negative');
  if (amount > 0xffffffffffffffffn) throw new Error('System u64 overflow');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, amount, true);
  return out;
}

/**
 * SystemProgram.Transfer raw instruction.
 *
 * Layout:
 *   - discriminator  u32 LE = 2
 *   - lamports       u64 LE
 *
 * Accounts:
 *   - from  (signer, writable) — the treasury PDA (signed via Execute CPI)
 *   - to    (writable)         — destination wallet
 */
function buildSystemTransferIx(args: {
  fromPda: PublicKey;
  destination: PublicKey;
  lamports: bigint;
}): Instruction {
  const data = new Uint8Array(4 + 8);
  // u32 LE discriminator (2 = Transfer).
  data[0] = 2;
  data.set(encodeU64Le(args.lamports), 4);
  return {
    programId: SYSTEM_PROGRAM_ID,
    keys: [
      // mpl-core's `execute` helper rewrites this `isSigner` to false
      // and signs via CPI; we declare it true so the inner instruction
      // is well-formed before the rewrite.
      { pubkey: args.fromPda, isSigner: true, isWritable: true },
      { pubkey: args.destination, isSigner: false, isWritable: true },
    ],
    data,
  };
}

function toPk(input: string | PublicKey): PublicKey {
  return typeof input === 'string' ? publicKey(input) : input;
}

export type WithdrawTreasurySolArgs = {
  /** The agent's Core asset address (mint). */
  agentAsset: string | PublicKey;
  /** Destination wallet that receives the lamports. */
  destination: string | PublicKey;
  /**
   * Amount in **lamports** (1 SOL = 1_000_000_000 lamports). To withdraw
   * the full spendable balance, prefer {@link withdrawTreasurySolAll}.
   */
  lamports: bigint;
  /** Rent + fee payer. Defaults to `umi.payer`. */
  payer?: Signer;
  /**
   * Owner of the agent asset (the wallet that minted it). Required for
   * `mpl-core::Execute`. Defaults to `umi.identity`.
   */
  authority?: Signer;
};

export type WithdrawTreasurySolResult = {
  /** Base58 transaction signature. */
  signature: string;
  /** Agent treasury (Asset Signer PDA). */
  treasury: string;
  /** Echo of the destination wallet. */
  destination: string;
  /** Echo of the lamport amount that was transferred. */
  lamports: bigint;
};

export type PrepareWithdrawTreasurySolResult = {
  /** Unsigned `mpl-core::Execute(System.Transfer)` builder. */
  builder: ReturnType<typeof execute>;
  /** Agent treasury (Asset Signer PDA). */
  treasury: string;
  /** Echo of the destination wallet. */
  destination: string;
  /** Echo of the lamport amount that will be transferred. */
  lamports: bigint;
};

/**
 * Build (but do not send) the `mpl-core::Execute(SystemProgram.Transfer)`
 * transaction for a SOL withdrawal. Same arg shape as
 * {@link withdrawTreasurySol} — useful for HTTP / remote-signer flows.
 */
export function prepareWithdrawTreasurySol(
  umi: Umi,
  args: WithdrawTreasurySolArgs,
): PrepareWithdrawTreasurySolResult {
  if (args.lamports <= 0n) throw new Error('withdraw lamports must be positive');
  const asset = toPk(args.agentAsset);
  const destination = toPk(args.destination);

  const [treasury] = findAssetSignerPda(umi, { asset });

  const transferIx = buildSystemTransferIx({
    fromPda: treasury,
    destination,
    lamports: args.lamports,
  });

  const builder = execute(umi, {
    asset: { publicKey: asset },
    instructions: [transferIx],
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.authority ? { authority: args.authority } : {}),
  });

  return {
    builder,
    treasury: String(treasury),
    destination: String(destination),
    lamports: args.lamports,
  };
}

/**
 * Withdraw `lamports` of native SOL from the agent treasury PDA to
 * `destination`. Sends and confirms the transaction.
 *
 * The agent owner (`authority`, defaults to `umi.identity`) signs once;
 * the mpl-core `Execute` instruction CPI-signs the inner SystemProgram
 * Transfer on behalf of the asset signer PDA — the same wrap pattern
 * the SDK uses for SPL `Approve` / `TransferChecked`.
 *
 * @example
 * ```ts
 * await withdrawTreasurySol(umi, {
 *   agentAsset: 'CoreAss…Asset',
 *   destination: ownerWallet.address,
 *   lamports: 1_000_000n, // 0.001 SOL
 * });
 * ```
 */
export async function withdrawTreasurySol(
  umi: Umi,
  args: WithdrawTreasurySolArgs,
): Promise<WithdrawTreasurySolResult> {
  const prepared = prepareWithdrawTreasurySol(umi, args);
  const result = await prepared.builder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    treasury: prepared.treasury,
    destination: prepared.destination,
    lamports: prepared.lamports,
  };
}

export type WithdrawTreasurySolAllArgs = Omit<WithdrawTreasurySolArgs, 'lamports'> & {
  /**
   * Lamports to leave behind on the treasury PDA. Defaults to
   * {@link DEFAULT_SOL_RESERVE_LAMPORTS}. Increase this if you want to
   * keep enough SOL on the PDA to cover its own future tx fees in
   * automated workflows.
   */
  reserveLamports?: bigint;
};

/**
 * Build (but do not send) the SOL "withdraw all" transaction. Reads the
 * treasury's current balance, subtracts the safety reserve, and
 * constructs an unsigned `mpl-core::Execute(System.Transfer)` for the
 * remaining lamports.
 *
 * Returns `null` (no builder, no echo fields) when the spendable balance
 * is zero — same "skip submission" semantics as
 * {@link prepareProvisionTreasuryAtas}.
 */
export async function prepareWithdrawTreasurySolAll(
  umi: Umi,
  args: WithdrawTreasurySolAllArgs,
): Promise<PrepareWithdrawTreasurySolResult | null> {
  const asset = toPk(args.agentAsset);
  const [treasury] = findAssetSignerPda(umi, { asset });
  const reserve = args.reserveLamports ?? DEFAULT_SOL_RESERVE_LAMPORTS;

  const balance = await umi.rpc.getBalance(treasury);
  const total = balance.basisPoints;
  if (total <= reserve) return null;

  const lamports = total - reserve;
  return prepareWithdrawTreasurySol(umi, {
    agentAsset: args.agentAsset,
    destination: args.destination,
    lamports,
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.authority ? { authority: args.authority } : {}),
  });
}

/**
 * Convenience wrapper that reads the treasury's current SOL balance,
 * subtracts a configurable safety reserve, and withdraws the rest.
 *
 * Returns `null` (no transaction broadcast) when there's nothing to
 * withdraw — this makes the "Withdraw all SOL" UI button safe to call
 * blindly without a prior balance check.
 */
export async function withdrawTreasurySolAll(
  umi: Umi,
  args: WithdrawTreasurySolAllArgs,
): Promise<WithdrawTreasurySolResult | null> {
  const prepared = await prepareWithdrawTreasurySolAll(umi, args);
  if (prepared == null) return null;
  const result = await prepared.builder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    treasury: prepared.treasury,
    destination: prepared.destination,
    lamports: prepared.lamports,
  };
}

export type TreasurySolBalance = {
  /** Agent treasury (Asset Signer PDA). */
  treasury: string;
  /** Total lamports on the PDA. */
  lamports: bigint;
  /** SOL value as a number — lossy for very large balances. */
  sol: number;
  /**
   * Spendable lamports = `lamports - reserveLamports`. `0n` when the
   * balance is below the reserve. This is what "Withdraw all" would
   * actually transfer.
   */
  spendableLamports: bigint;
  /** Spendable SOL as a number — same lossy caveat as `sol`. */
  spendableSol: number;
};

/**
 * Read the current native-SOL balance of the agent treasury PDA. Useful
 * for UI gating ("Withdraw all" button is only enabled when there's
 * something spendable above the reserve) and for displaying creator-fee
 * earnings from a Genesis token launch.
 */
export async function getTreasurySolBalance(
  umi: Umi,
  args: { agentAsset: string | PublicKey; reserveLamports?: bigint },
): Promise<TreasurySolBalance> {
  const asset = toPk(args.agentAsset);
  const reserve = args.reserveLamports ?? DEFAULT_SOL_RESERVE_LAMPORTS;
  const [treasury] = findAssetSignerPda(umi, { asset });
  const balance = await umi.rpc.getBalance(treasury);
  const lamports = balance.basisPoints;
  const spendableLamports = lamports > reserve ? lamports - reserve : 0n;
  return {
    treasury: String(treasury),
    lamports,
    sol: Number(lamports) / 1_000_000_000,
    spendableLamports,
    spendableSol: Number(spendableLamports) / 1_000_000_000,
  };
}

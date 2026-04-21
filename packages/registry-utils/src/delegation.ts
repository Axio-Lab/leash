/**
 * SPL token delegation from an agent's Asset Signer PDA to its registered
 * executive. This is the on-chain wiring that lets a Privy embedded wallet
 * spend the agent's USDC treasury via standard `TransferChecked` while
 * the funds physically live on the agent's PDA — i.e. the client funds
 * the agent, the agent makes them money.
 *
 * Why a delegation (and not a per-call Core `Execute` wrap)?
 *
 *   - Every production x402 facilitator we tested (svmacc.tech,
 *     payai.network, x402.org/facilitator, Coinbase CDP) only signs
 *     vanilla SPL `TransferChecked`. Wrapping the transfer in
 *     mpl-core::Execute would require facilitator changes on the seller
 *     side, which we don't control. SPL delegation keeps the on-chain
 *     transfer shape identical.
 *
 *   - Spend authority is bounded: the executive can only move up to the
 *     `delegated_amount` recorded on the source token account. Refilling
 *     and revoking are explicit actions the owner takes.
 *
 *   - Funds remain owned by the agent's PDA. Every settled call debits
 *     the agent treasury; refunds and earnings credit it back.
 *
 * Implementation notes:
 *
 *   - The on-chain "owner" of the source ATA is the Asset Signer PDA,
 *     which can only sign via mpl-core's `Execute` instruction. We use
 *     `mpl-core/execute` to wrap a raw SPL `Approve` (or `Revoke`)
 *     instruction; mpl-core rewrites the asset-signer key to
 *     `isSigner: false` and the program signs it during CPI.
 *
 *   - We `createIdempotentAssociatedToken` first so funding-then-delegate
 *     also works on a fresh agent that hasn't received its first USDC
 *     yet. The executive pays the rent (~2k lamports) — well below the
 *     mint cost.
 *
 *   - The serialisation of `Approve` / `Revoke` is the SPL Token
 *     program's classic-token discriminators (4 = Approve, 5 = Revoke);
 *     we ship them as raw bytes so we don't depend on web3.js inside
 *     `@leash/registry-utils`.
 */

import { execute } from '@metaplex-foundation/mpl-core';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import {
  createIdempotentAssociatedToken,
  findAssociatedTokenPda,
} from '@metaplex-foundation/mpl-toolbox';
import {
  publicKey,
  type Instruction,
  type PublicKey,
  type Signer,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

/** Classic SPL Token program (TokenkegQ…). */
export const SPL_TOKEN_PROGRAM_ID = publicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
/** Token-2022 program. Pass to {@link setSpendDelegation} via `tokenProgram` for newer mints. */
export const TOKEN_2022_PROGRAM_ID = publicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export type SetSpendDelegationArgs = {
  /** The agent's Core asset address (mint). */
  agentAsset: string | PublicKey;
  /** The SPL mint to delegate (e.g. USDC). */
  mint: string | PublicKey;
  /** The executive wallet that gets spend authority (e.g. user's Privy wallet). */
  executive: string | PublicKey;
  /**
   * Maximum amount the executive can move in **atomic units** of the mint
   * (e.g. for USDC with 6 decimals: `5_000_000n` = 5 USDC). Pass
   * `2n ** 64n - 1n` for an effectively unlimited delegation.
   */
  amount: bigint;
  /**
   * Rent payer for the ATA + tx fees. Defaults to `umi.payer` (the
   * connected wallet). The executive is a sensible default since they
   * usually have SOL on hand.
   */
  payer?: Signer;
  /**
   * Owner of the agent asset (the wallet that minted it). Required for
   * mpl-core `Execute` — only the asset owner can authorise execution.
   * Defaults to `umi.identity`.
   */
  authority?: Signer;
  /**
   * The token program that owns the mint. Defaults to classic SPL Token.
   * Pass {@link TOKEN_2022_PROGRAM_ID} for Token-2022 mints.
   */
  tokenProgram?: PublicKey;
};

export type SetSpendDelegationResult = {
  /** Base58 transaction signature. */
  signature: string;
  /** The agent treasury address (Asset Signer PDA). */
  treasury: string;
  /** The agent's ATA for `mint`. This is what the buyer signer uses as `source`. */
  sourceTokenAccount: string;
  /** Echo of the cap (atomic units). */
  delegatedAmount: bigint;
  /** Echo of the delegate (executive). */
  delegate: string;
};

/** Encode a u64 LE for SPL Token instructions. */
function encodeU64Le(amount: bigint): Uint8Array {
  if (amount < 0n) throw new Error('SPL u64 cannot be negative');
  if (amount > 0xffffffffffffffffn) throw new Error('SPL u64 overflow');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, amount, true);
  return out;
}

/** SPL Token classic discriminator: 4 = Approve. */
function buildApproveIx(args: {
  source: PublicKey;
  delegate: PublicKey;
  ownerPda: PublicKey;
  amount: bigint;
  programId: PublicKey;
}): Instruction {
  const data = new Uint8Array(1 + 8);
  data[0] = 4;
  data.set(encodeU64Le(args.amount), 1);
  return {
    programId: args.programId,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.delegate, isSigner: false, isWritable: false },
      // mpl-core's `execute` helper rewrites this to `isSigner: false` and
      // signs via CPI. We declare it as a signer here so the inner
      // instruction is well-formed.
      { pubkey: args.ownerPda, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/** SPL Token classic discriminator: 5 = Revoke. */
function buildRevokeIx(args: {
  source: PublicKey;
  ownerPda: PublicKey;
  programId: PublicKey;
}): Instruction {
  return {
    programId: args.programId,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.ownerPda, isSigner: true, isWritable: false },
    ],
    data: new Uint8Array([5]),
  };
}

function toPk(input: string | PublicKey): PublicKey {
  return typeof input === 'string' ? publicKey(input) : input;
}

/**
 * Approve `amount` (in atomic units) of `mint` from the agent's treasury
 * ATA to `executive`. Idempotently creates the agent's ATA if missing.
 *
 * Sends and confirms the transaction. The user signs once; the resulting
 * delegation persists on-chain until either it's exhausted by transfers
 * or {@link revokeSpendDelegation} is called.
 *
 * @example
 * ```ts
 * await setSpendDelegation(umi, {
 *   agentAsset: 'CoreAss…Asset',
 *   mint: USDC_DEVNET,
 *   executive: privyWallet.address,
 *   amount: 5_000_000n, // $5 USDC
 * });
 * ```
 */
export async function setSpendDelegation(
  umi: Umi,
  args: SetSpendDelegationArgs,
): Promise<SetSpendDelegationResult> {
  const asset = toPk(args.agentAsset);
  const mint = toPk(args.mint);
  const delegate = toPk(args.executive);
  const tokenProgram = args.tokenProgram ?? SPL_TOKEN_PROGRAM_ID;

  const [treasury] = findAssetSignerPda(umi, { asset });
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint,
    owner: treasury,
    tokenProgramId: tokenProgram,
  });

  const approveIx = buildApproveIx({
    source: sourceAta,
    delegate,
    ownerPda: treasury,
    amount: args.amount,
    programId: tokenProgram,
  });

  const executeBuilder = execute(umi, {
    asset: { publicKey: asset },
    instructions: [approveIx],
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.authority ? { authority: args.authority } : {}),
  });

  // Prepend a no-op-on-existing ATA create so freshly minted agents that
  // haven't received funds yet still get a delegation. The executive pays
  // the ~2k lamport rent.
  const fullBuilder = createIdempotentAssociatedToken(umi, {
    mint,
    owner: treasury,
    ata: sourceAta,
    tokenProgram,
    ...(args.payer ? { payer: args.payer } : {}),
  }).add(executeBuilder);

  const result = await fullBuilder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    treasury: String(treasury),
    sourceTokenAccount: String(sourceAta),
    delegatedAmount: args.amount,
    delegate: String(delegate),
  };
}

export type RevokeSpendDelegationArgs = {
  agentAsset: string | PublicKey;
  mint: string | PublicKey;
  payer?: Signer;
  authority?: Signer;
  tokenProgram?: PublicKey;
};

/**
 * Drop any active delegation on the agent's `mint` ATA. After this lands,
 * the executive can no longer move funds (`delegate = None`,
 * `delegated_amount = 0`).
 */
export async function revokeSpendDelegation(
  umi: Umi,
  args: RevokeSpendDelegationArgs,
): Promise<{ signature: string; treasury: string; sourceTokenAccount: string }> {
  const asset = toPk(args.agentAsset);
  const mint = toPk(args.mint);
  const tokenProgram = args.tokenProgram ?? SPL_TOKEN_PROGRAM_ID;

  const [treasury] = findAssetSignerPda(umi, { asset });
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint,
    owner: treasury,
    tokenProgramId: tokenProgram,
  });

  const revokeIx = buildRevokeIx({
    source: sourceAta,
    ownerPda: treasury,
    programId: tokenProgram,
  });
  const builder = execute(umi, {
    asset: { publicKey: asset },
    instructions: [revokeIx],
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.authority ? { authority: args.authority } : {}),
  });

  const result = await builder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    treasury: String(treasury),
    sourceTokenAccount: String(sourceAta),
  };
}

export type SpendDelegationStatus = {
  /** Agent treasury (Asset Signer PDA). */
  treasury: string;
  /** Agent's ATA for `mint`. May not exist yet. */
  sourceTokenAccount: string;
  /** True if the ATA exists on-chain (has been initialized). */
  sourceExists: boolean;
  /**
   * Current treasury balance in atomic units of the mint (`0n` if the ATA
   * doesn't exist yet).
   */
  balance: bigint;
  /**
   * Active delegate, or `null` if no delegation is set. Compare against
   * the executive address to confirm the wiring.
   */
  delegate: string | null;
  /** Remaining authorised spend in atomic units. `0n` when none. */
  delegatedAmount: bigint;
};

/**
 * Fetch the current delegation + balance on the agent's `mint` ATA.
 * Returns `sourceExists: false` if the ATA hasn't been created yet (the
 * agent has never been funded with this mint).
 *
 * Useful for UI gating ("not enough delegation to cover this $0.05 call")
 * and post-payment health checks (delegation should drop after each
 * settled transfer).
 */
export async function getSpendDelegation(
  umi: Umi,
  args: { agentAsset: string | PublicKey; mint: string | PublicKey; tokenProgram?: PublicKey },
): Promise<SpendDelegationStatus> {
  const asset = toPk(args.agentAsset);
  const mint = toPk(args.mint);
  const tokenProgram = args.tokenProgram ?? SPL_TOKEN_PROGRAM_ID;

  const [treasury] = findAssetSignerPda(umi, { asset });
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint,
    owner: treasury,
    tokenProgramId: tokenProgram,
  });

  const account = await umi.rpc.getAccount(sourceAta);
  if (!account.exists) {
    return {
      treasury: String(treasury),
      sourceTokenAccount: String(sourceAta),
      sourceExists: false,
      balance: 0n,
      delegate: null,
      delegatedAmount: 0n,
    };
  }
  const parsed = parseTokenAccount(account.data);
  return {
    treasury: String(treasury),
    sourceTokenAccount: String(sourceAta),
    sourceExists: true,
    balance: parsed.amount,
    delegate: parsed.delegate ? String(publicKey(parsed.delegate)) : null,
    delegatedAmount: parsed.delegatedAmount,
  };
}

/**
 * Minimal SPL Token Account / Token-2022 layout parser. Both layouts share
 * the same first 165 bytes:
 *
 *   mint                  (32)
 *   owner                 (32)
 *   amount                (u64 LE)
 *   delegate option       (4)   — `1u32` = some, `0u32` = none
 *   delegate              (32)  — only valid when option = 1
 *   state                 (1)
 *   isNative option       (4)
 *   isNative              (8)
 *   delegatedAmount       (u64 LE)
 *   closeAuthority option (4)
 *   closeAuthority        (32)
 *
 * Token-2022 appends extensions after byte 165 which we ignore (we only
 * care about delegation state, not the extensions metadata).
 */
function parseTokenAccount(data: Uint8Array): {
  amount: bigint;
  delegate: Uint8Array | null;
  delegatedAmount: bigint;
} {
  if (data.length < 165) {
    throw new Error(`token account too small: ${data.length}`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const amount = dv.getBigUint64(64, true);
  const delegateTag = dv.getUint32(72, true);
  const delegate = delegateTag === 1 ? data.slice(76, 76 + 32) : null;
  const delegatedAmount = dv.getBigUint64(121, true);
  return { amount, delegate, delegatedAmount };
}

/**
 * Owner-driven withdrawals from an agent's treasury (Asset Signer PDA).
 *
 * The agent treasury is owned by the asset signer PDA derived from the
 * agent's Core asset; only the **owner** of that asset can authorise an
 * `mpl-core::Execute` instruction, and only that instruction can sign on
 * the PDA's behalf during CPI. We use the same wrap pattern as
 * `setSpendDelegation` in `./delegation.ts`, but the inner instruction is
 * SPL `TransferChecked` (discriminator 12) instead of `Approve`.
 *
 * Why `TransferChecked` (not bare `Transfer`)?
 *
 *   - Token-2022 mints with a transfer-fee extension reject the legacy
 *     `Transfer` discriminator. `TransferChecked` always works for both
 *     classic SPL Token and Token-2022 mints — it's the safer default for
 *     a treasury that may hold either kind of stable.
 *
 *   - The `decimals` byte gives the runtime an extra integrity check
 *     against caller-supplied amounts. If it doesn't match the mint's
 *     decimals on chain, the program aborts with a clear error instead
 *     of silently moving the wrong amount.
 *
 * Why this lives in `@leash/registry-utils` (and not `@leash/core/treasury`)?
 *
 *   Mirrors `./delegation.ts` (same mpl-core/mpl-toolbox dependency
 *   surface), which keeps `@leash/core` free of mpl-core to stay
 *   bundleable in browser-only buyer/seller contexts.
 */

import { execute, findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import {
  publicKey,
  type Instruction,
  type PublicKey,
  type Signer,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { SPL_TOKEN_PROGRAM_ID } from './delegation.js';

/** Encode a u64 LE for SPL Token instructions. */
function encodeU64Le(amount: bigint): Uint8Array {
  if (amount < 0n) throw new Error('SPL u64 cannot be negative');
  if (amount > 0xffffffffffffffffn) throw new Error('SPL u64 overflow');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, amount, true);
  return out;
}

/**
 * SPL Token classic discriminator: 12 = TransferChecked.
 *
 * Layout:
 *   - source       (writable, owner = treasury PDA, must sign via Execute CPI)
 *   - mint         (read-only)
 *   - destination  (writable)
 *   - authority    (signer = treasury PDA; rewritten by mpl-core to non-signer
 *                   then CPI-signed)
 *
 * Data: `[discriminator (1) | amount (u64 LE, 8) | decimals (u8, 1)]`
 */
function buildTransferCheckedIx(args: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authorityPda: PublicKey;
  amount: bigint;
  decimals: number;
  programId: PublicKey;
}): Instruction {
  const data = new Uint8Array(1 + 8 + 1);
  data[0] = 12;
  data.set(encodeU64Le(args.amount), 1);
  data[9] = args.decimals & 0xff;
  return {
    programId: args.programId,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      // mpl-core's `execute` helper rewrites this to `isSigner: false` and
      // signs via CPI. We declare it as a signer so the inner instruction
      // is well-formed before the rewrite.
      { pubkey: args.authorityPda, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/**
 * Read an SPL Token mint account and return its `decimals` byte. Used
 * to populate the `TransferChecked` decimals slot without requiring the
 * caller to remember which mint has 6 vs 9 decimals.
 *
 * Mint layout (first 45 bytes, identical for classic Token + Token-2022):
 *   mint_authority option (4)  + mint_authority (32)  // ignored
 *   supply                (8)                          // ignored
 *   decimals              (1)                          // <- byte 44
 *   ...
 */
async function readMintDecimals(umi: Umi, mint: PublicKey): Promise<number> {
  const account = await umi.rpc.getAccount(mint);
  if (!account.exists) throw new Error(`mint ${String(mint)} does not exist on this RPC`);
  if (account.data.length < 45) {
    throw new Error(`mint ${String(mint)} has unexpected data length ${account.data.length} (<45)`);
  }
  return account.data[44] ?? 0;
}

function toPk(input: string | PublicKey): PublicKey {
  return typeof input === 'string' ? publicKey(input) : input;
}

export type WithdrawTreasuryArgs = {
  /** The agent's Core asset address (mint). */
  agentAsset: string | PublicKey;
  /** The SPL mint to withdraw (e.g. USDC). */
  mint: string | PublicKey;
  /**
   * Destination wallet that receives the funds. The wallet's ATA for
   * `mint` is computed automatically. The wallet must already have an
   * initialised ATA for `mint` — pass `createDestinationAtaIfMissing:
   * true` to have the executive pay rent and bundle a CreateIdempotent
   * in the same tx.
   */
  destination: string | PublicKey;
  /**
   * Amount in **atomic units** of the mint (e.g. for USDC with 6 decimals:
   * `1_000_000n` = 1 USDC). To withdraw the full balance, prefer
   * {@link withdrawTreasuryAll} which reads the balance for you.
   */
  amount: bigint;
  /**
   * If the destination ATA doesn't exist on-chain yet, prepend a
   * CreateIdempotent. The signer pays the ~2k lamport rent. Defaults to
   * `true` so "send to a fresh wallet" Just Works.
   */
  createDestinationAtaIfMissing?: boolean;
  /**
   * Rent + fee payer. Defaults to `umi.payer` (the connected wallet).
   * Distinct from `authority` — the payer can be any wallet with SOL,
   * the authority must be the asset owner.
   */
  payer?: Signer;
  /**
   * Owner of the agent asset. Required for `mpl-core::Execute` —
   * only the asset owner can authorise execution. Defaults to
   * `umi.identity`.
   */
  authority?: Signer;
  /**
   * The SPL token program that owns `mint`. Defaults to the classic
   * SPL Token program. Pass `TOKEN_2022_PROGRAM_ID` (re-exported from
   * `./delegation.js`) for Token-2022 mints.
   */
  tokenProgram?: PublicKey;
  /**
   * Pre-fetched mint decimals. Skips the RPC roundtrip when the caller
   * already knows the value (e.g. UI that already loaded balances).
   */
  decimals?: number;
};

export type WithdrawTreasuryResult = {
  /** Base58 transaction signature. */
  signature: string;
  /** Agent treasury (Asset Signer PDA). */
  treasury: string;
  /** Source ATA the funds were debited from (treasury's ATA for `mint`). */
  sourceTokenAccount: string;
  /** Destination ATA the funds were credited to. */
  destinationTokenAccount: string;
  /** Echo of the withdrawn amount in atomic units. */
  amount: bigint;
  /** Echo of the destination wallet (not its ATA). */
  destination: string;
};

/**
 * Withdraw `amount` (in atomic units) of `mint` from the agent treasury
 * to `destination`'s ATA. Sends and confirms the transaction.
 *
 * The agent owner (`authority`, defaults to `umi.identity`) signs once;
 * the mpl-core `Execute` instruction CPI-signs the inner SPL
 * `TransferChecked` on behalf of the asset signer PDA. Spend allowance
 * delegations to executives are unaffected — withdraws bypass the
 * delegation slot because the owner is signing directly.
 *
 * @example
 * ```ts
 * await withdrawTreasury(umi, {
 *   agentAsset: 'CoreAss…Asset',
 *   mint: USDC_DEVNET,
 *   destination: ownerWallet.address,
 *   amount: 5_000_000n, // $5 USDC
 * });
 * ```
 */
export async function withdrawTreasury(
  umi: Umi,
  args: WithdrawTreasuryArgs,
): Promise<WithdrawTreasuryResult> {
  if (args.amount <= 0n) throw new Error('withdraw amount must be positive');
  const asset = toPk(args.agentAsset);
  const mint = toPk(args.mint);
  const destinationOwner = toPk(args.destination);
  const tokenProgram = args.tokenProgram ?? SPL_TOKEN_PROGRAM_ID;

  const [treasury] = findAssetSignerPda(umi, { asset });
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint,
    owner: treasury,
    tokenProgramId: tokenProgram,
  });
  const [destinationAta] = findAssociatedTokenPda(umi, {
    mint,
    owner: destinationOwner,
    tokenProgramId: tokenProgram,
  });

  const decimals = args.decimals ?? (await readMintDecimals(umi, mint));

  const transferIx = buildTransferCheckedIx({
    source: sourceAta,
    mint,
    destination: destinationAta,
    authorityPda: treasury,
    amount: args.amount,
    decimals,
    programId: tokenProgram,
  });

  let builder = execute(umi, {
    asset: { publicKey: asset },
    instructions: [transferIx],
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.authority ? { authority: args.authority } : {}),
  });

  // Optionally bundle CreateIdempotent for the destination ATA so
  // owners can withdraw to a brand-new wallet without a separate
  // "create my ATA" step.
  if (args.createDestinationAtaIfMissing !== false) {
    const destAcct = await umi.rpc.getAccount(destinationAta);
    if (!destAcct.exists) {
      const { createIdempotentAssociatedToken } = await import('@metaplex-foundation/mpl-toolbox');
      const create = createIdempotentAssociatedToken(umi, {
        mint,
        owner: destinationOwner,
        ata: destinationAta,
        tokenProgram,
        ...(args.payer ? { payer: args.payer } : {}),
      });
      builder = create.add(builder);
    }
  }

  const result = await builder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    treasury: String(treasury),
    sourceTokenAccount: String(sourceAta),
    destinationTokenAccount: String(destinationAta),
    amount: args.amount,
    destination: String(destinationOwner),
  };
}

export type WithdrawTreasuryAllArgs = Omit<WithdrawTreasuryArgs, 'amount'>;

/**
 * Convenience wrapper that reads the current treasury balance for `mint`
 * and withdraws all of it. Throws if the treasury ATA doesn't exist or
 * has zero balance — callers should defend with a balance pre-flight in
 * UI flows so users see "nothing to withdraw" instead of an opaque error.
 *
 * Returns `null` when the treasury ATA has zero balance (no transaction
 * is broadcast). This makes the "Withdraw all" UI button safe to call
 * blindly without a prior balance check.
 */
export async function withdrawTreasuryAll(
  umi: Umi,
  args: WithdrawTreasuryAllArgs,
): Promise<WithdrawTreasuryResult | null> {
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
  if (!account.exists) return null;
  // First 64 bytes are mint+owner; bytes 64..72 are the u64 LE amount.
  if (account.data.length < 72) {
    throw new Error(
      `treasury ATA ${String(sourceAta)} has unexpected length ${account.data.length}`,
    );
  }
  const dv = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
  const balance = dv.getBigUint64(64, true);
  if (balance === 0n) return null;

  return withdrawTreasury(umi, { ...args, amount: balance });
}

/**
 * Read the current spendable balance of the agent treasury for `mint`.
 * Returns `0n` when the treasury ATA has not been initialised yet.
 *
 * Convenience wrapper used by the playground's withdraw UI to populate
 * the "Available" badge; consumers that already call
 * {@link import('./delegation.js').getSpendDelegation} can read the
 * `balance` field there instead.
 */
export async function getTreasuryBalance(
  umi: Umi,
  args: { agentAsset: string | PublicKey; mint: string | PublicKey; tokenProgram?: PublicKey },
): Promise<bigint> {
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
  if (!account.exists) return 0n;
  if (account.data.length < 72) return 0n;
  const dv = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
  return dv.getBigUint64(64, true);
}

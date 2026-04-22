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

/**
 * The two stablecoins Leash auto-provisions an ATA for at agent-creation
 * time on each network. Keeping the list curated (vs. "every conceivable
 * mint") keeps the per-agent rent cost predictable — each ATA is ~0.00203
 * SOL, so 2 ATAs ≈ 0.004 SOL. Add more by editing this constant.
 *
 * Why pre-provision? See {@link provisionTreasuryAtas}.
 */
export const KNOWN_STABLES: Record<
  'solana-mainnet' | 'solana-devnet',
  Array<{ symbol: string; mint: PublicKey; tokenProgram: PublicKey }>
> = {
  'solana-mainnet': [
    {
      symbol: 'USDC',
      mint: publicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
    },
    {
      symbol: 'USDT',
      mint: publicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
    },
    {
      symbol: 'USDG',
      mint: publicKey('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH'),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
    },
  ],
  'solana-devnet': [
    {
      symbol: 'USDC',
      mint: publicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
    },
    {
      symbol: 'USDT',
      mint: publicKey('EcFc2cMyZxaKBkFK1XooxiyDyCPneLXiMwSJiVY6eTad'),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
    },
    {
      symbol: 'USDG',
      mint: publicKey('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7'),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
    },
  ],
};

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

  // Defensive ATA pre-flight. The SPL ATA program throws
  //   "Provided owner is not allowed"
  // when the on-chain account at `sourceAta` is not owned by the SPL Token
  // program (e.g. it was allocated to a different program by accident, or
  // the address derivation we expect doesn't actually match what was
  // funded). `CreateIdempotent` only succeeds when the existing account is
  // a real token account whose internal mint+owner fields match what we'd
  // create. We replicate that validation here so users get a precise
  // diagnostic instead of a generic simulation failure.
  const ataState = await inspectTokenAccount(umi, {
    address: sourceAta,
    expectedMint: mint,
    expectedOwner: treasury,
    expectedTokenProgram: tokenProgram,
  });

  let builder = transactionBuilderFromMaybeApprove(umi, {
    sourceAta,
    delegate,
    ownerPda: treasury,
    amount: args.amount,
    tokenProgram,
    asset,
    payer: args.payer,
    authority: args.authority,
  });

  if (!ataState.exists) {
    // No account at the canonical address yet — prepend a CreateIdempotent
    // so freshly minted agents that haven't received funds yet still get a
    // delegation. The signer (umi.payer or args.payer) covers the ~2k
    // lamport rent.
    const create = createIdempotentAssociatedToken(umi, {
      mint,
      owner: treasury,
      ata: sourceAta,
      tokenProgram,
      ...(args.payer ? { payer: args.payer } : {}),
    });
    builder = create.add(builder);
  }
  // If `ataState.exists && ataState.valid`, we skip the create step
  // entirely. This is the common case for agents whose treasury has
  // already been provisioned (either by `provisionTreasuryAtas` at
  // creation time, or by a USDC transfer landing first).

  const result = await builder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    treasury: String(treasury),
    sourceTokenAccount: String(sourceAta),
    delegatedAmount: args.amount,
    delegate: String(delegate),
  };
}

/**
 * Build a `mpl-core::Execute(SPL.Approve)` transaction-builder. Pulled out
 * so {@link setSpendDelegation} can choose whether to prepend a
 * `CreateIdempotent` for the ATA based on its on-chain state.
 */
function transactionBuilderFromMaybeApprove(
  umi: Umi,
  args: {
    sourceAta: PublicKey;
    delegate: PublicKey;
    ownerPda: PublicKey;
    amount: bigint;
    tokenProgram: PublicKey;
    asset: PublicKey;
    payer?: Signer;
    authority?: Signer;
  },
): TransactionBuilderLike {
  const approveIx = buildApproveIx({
    source: args.sourceAta,
    delegate: args.delegate,
    ownerPda: args.ownerPda,
    amount: args.amount,
    programId: args.tokenProgram,
  });
  return execute(umi, {
    asset: { publicKey: args.asset },
    instructions: [approveIx],
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.authority ? { authority: args.authority } : {}),
  });
}

/** Sub-type of mpl-toolbox's TransactionBuilder we actually need here. */
type TransactionBuilderLike = ReturnType<typeof execute>;

type AtaState =
  | { exists: false }
  | {
      exists: true;
      valid: true;
      mint: PublicKey;
      owner: PublicKey;
      delegate: PublicKey | null;
      delegatedAmount: bigint;
      amount: bigint;
    };

/**
 * Read an ATA and validate that, if it exists, it's a real SPL Token
 * account whose program-owner is the expected token program AND whose
 * internal `mint`/`owner` fields match what we'd create. Throws a clear
 * error on every other "exists but wrong" state — those would otherwise
 * surface as a confusing facilitator/simulation error downstream.
 */
async function inspectTokenAccount(
  umi: Umi,
  args: {
    address: PublicKey;
    expectedMint: PublicKey;
    expectedOwner: PublicKey;
    expectedTokenProgram: PublicKey;
  },
): Promise<AtaState> {
  const account = await umi.rpc.getAccount(args.address);
  if (!account.exists) return { exists: false };
  const ownerStr = String(account.owner);
  const expectedTokenProgramStr = String(args.expectedTokenProgram);
  if (ownerStr !== expectedTokenProgramStr) {
    throw new Error(
      `ATA ${String(args.address)} exists but is owned by program ${ownerStr}; ` +
        `expected token program ${expectedTokenProgramStr}. This is the on-chain shape ` +
        `the SPL ATA program rejects with "Provided owner is not allowed". ` +
        `Inspect the address on Solscan; if it really is a token account on a different ` +
        `token program (classic vs Token-2022), pass the matching \`tokenProgram\` to setSpendDelegation.`,
    );
  }
  const parsed = parseTokenAccount(account.data);
  const actualMint = publicKey(parsed.mint);
  const actualOwner = publicKey(parsed.owner);
  if (String(actualMint) !== String(args.expectedMint)) {
    throw new Error(
      `ATA ${String(args.address)} exists for mint ${String(actualMint)} but caller asked for ${String(args.expectedMint)}.`,
    );
  }
  if (String(actualOwner) !== String(args.expectedOwner)) {
    throw new Error(
      `ATA ${String(args.address)} is owned by ${String(actualOwner)}, not the agent treasury ${String(args.expectedOwner)}. ` +
        `This usually means the address you're treating as the agent treasury isn't actually ` +
        `the asset signer PDA. Re-derive with findAssetSignerPda(asset).`,
    );
  }
  return {
    exists: true,
    valid: true,
    mint: actualMint,
    owner: actualOwner,
    delegate: parsed.delegate ? publicKey(parsed.delegate) : null,
    delegatedAmount: parsed.delegatedAmount,
    amount: parsed.amount,
  };
}

export type ProvisionTreasuryAtasArgs = {
  /** The agent's Core asset address (mint). */
  agentAsset: string | PublicKey;
  /**
   * Mints to provision an ATA for. Defaults to {@link KNOWN_STABLES} for
   * `network`. Pass an empty array to skip (no-op).
   */
  mints?: Array<{ mint: string | PublicKey; tokenProgram?: PublicKey; symbol?: string }>;
  /** Default mint set when `mints` is omitted. */
  network?: 'solana-mainnet' | 'solana-devnet';
  /** Rent + fee payer. Defaults to `umi.payer`. */
  payer?: Signer;
};

export type ProvisionTreasuryAtasResult = {
  /** Agent treasury (Asset Signer PDA). */
  treasury: string;
  /** One entry per requested mint. `created=false` means the ATA already existed and was valid. */
  atas: Array<{
    mint: string;
    symbol?: string;
    address: string;
    tokenProgram: string;
    created: boolean;
    /** Set when at least one create instruction was emitted in this run. */
    signature?: string;
  }>;
};

/**
 * Idempotently create the agent treasury's Associated Token Accounts for a
 * curated set of mints (defaults to {@link KNOWN_STABLES}).
 *
 * Why pre-create? Two reasons.
 *
 * 1. **Predictable funding UX.** Users typically fund the agent through a
 *    faucet or wallet send. Most wallets refuse to send to an
 *    address that doesn't yet have an ATA, or they auto-create one and
 *    silently fund the *sender's* ATA (not the agent's). Provisioning the
 *    ATA up front means "send USDC to this address" Just Works.
 *
 * 2. **Cleaner Approve flow.** When the ATA already exists,
 *    {@link setSpendDelegation} skips the CreateIdempotent step and only
 *    sends a single `mpl-core::Execute(SPL.Approve)` — fewer surfaces for
 *    "Provided owner is not allowed" to fire.
 *
 * Returns one entry per mint. Idempotent: re-running is a no-op (and
 * doesn't even broadcast a transaction) once every ATA is already valid.
 */
export async function provisionTreasuryAtas(
  umi: Umi,
  args: ProvisionTreasuryAtasArgs,
): Promise<ProvisionTreasuryAtasResult> {
  const asset = toPk(args.agentAsset);
  const [treasury] = findAssetSignerPda(umi, { asset });

  const requested =
    args.mints ??
    KNOWN_STABLES[args.network ?? 'solana-devnet'].map((m) => ({
      mint: m.mint,
      tokenProgram: m.tokenProgram,
      symbol: m.symbol,
    }));

  const resolved = requested.map((m) => {
    const mintPk = toPk(m.mint);
    const tokenProgram = m.tokenProgram ?? SPL_TOKEN_PROGRAM_ID;
    const [ata] = findAssociatedTokenPda(umi, {
      mint: mintPk,
      owner: treasury,
      tokenProgramId: tokenProgram,
    });
    return {
      mintPk,
      tokenProgram,
      ata,
      symbol: m.symbol,
    };
  });

  // Inspect all ATAs first; only create the ones missing. Throw on
  // mismatch (same diagnostic policy as setSpendDelegation).
  const inspected = await Promise.all(
    resolved.map(async (r) => {
      const state = await inspectTokenAccount(umi, {
        address: r.ata,
        expectedMint: r.mintPk,
        expectedOwner: treasury,
        expectedTokenProgram: r.tokenProgram,
      });
      return { ...r, exists: state.exists };
    }),
  );

  const missing = inspected.filter((r) => !r.exists);
  if (missing.length === 0) {
    return {
      treasury: String(treasury),
      atas: inspected.map((r) => ({
        mint: String(r.mintPk),
        symbol: r.symbol,
        address: String(r.ata),
        tokenProgram: String(r.tokenProgram),
        created: false,
      })),
    };
  }

  // Bundle every CreateIdempotent into a single tx — typically 1–2 ATAs,
  // well under the 1232-byte tx size limit.
  let builder: TransactionBuilderLike | null = null;
  for (const r of missing) {
    const ix = createIdempotentAssociatedToken(umi, {
      mint: r.mintPk,
      owner: treasury,
      ata: r.ata,
      tokenProgram: r.tokenProgram,
      ...(args.payer ? { payer: args.payer } : {}),
    });
    builder = builder ? builder.add(ix) : ix;
  }
  // `builder` is non-null here because `missing.length > 0`.
  const result = await builder!.sendAndConfirm(umi);
  const signature = base58.deserialize(result.signature)[0];

  return {
    treasury: String(treasury),
    atas: inspected.map((r) => ({
      mint: String(r.mintPk),
      symbol: r.symbol,
      address: String(r.ata),
      tokenProgram: String(r.tokenProgram),
      created: !r.exists,
      ...(r.exists ? {} : { signature }),
    })),
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
  mint: Uint8Array;
  owner: Uint8Array;
  amount: bigint;
  delegate: Uint8Array | null;
  delegatedAmount: bigint;
} {
  if (data.length < 165) {
    throw new Error(`token account too small: ${data.length}`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const mint = data.slice(0, 32);
  const owner = data.slice(32, 64);
  const amount = dv.getBigUint64(64, true);
  const delegateTag = dv.getUint32(72, true);
  const delegate = delegateTag === 1 ? data.slice(76, 76 + 32) : null;
  const delegatedAmount = dv.getBigUint64(121, true);
  return { mint, owner, amount, delegate, delegatedAmount };
}

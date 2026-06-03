/**
 * Native Solana Subscriptions & Allowances helpers.
 *
 * These wrap the generated `@solana/subscriptions` Kit instructions and
 * adapt them to Leash's existing Umi transaction-builder flow. The native
 * program address is canonical on devnet + mainnet:
 *
 *   De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
 *
 * The helpers intentionally model the native program's signer semantics:
 * the wallet that owns the token account signs setup/revoke/subscribe,
 * while the delegatee / merchant / puller signs transfer/collect calls.
 */

import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import {
  publicKey,
  transactionBuilder,
  type Instruction as UmiInstruction,
  type PublicKey,
  type Signer,
  type TransactionBuilder,
  type Umi,
  type WrappedInstruction,
} from '@metaplex-foundation/umi';
import type { Address, Instruction as KitInstruction, TransactionSigner } from '@solana/kit';
import {
  PROGRAM_ID,
  PlanStatus,
  findFixedDelegationPda,
  findPlanPda,
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  findSubscriptionDelegationPda,
  getCancelSubscriptionOverlayInstructionAsync,
  getCloseSubscriptionAuthorityOverlayInstructionAsync,
  getCreateFixedDelegationOverlayInstructionAsync,
  getCreatePlanOverlayInstructionAsync,
  getCreateRecurringDelegationOverlayInstructionAsync,
  getFixedDelegationDecoder,
  getInitSubscriptionAuthorityOverlayInstructionAsync,
  getPlanDecoder,
  getRecurringDelegationDecoder,
  getResumeSubscriptionOverlayInstructionAsync,
  getRevokeDelegationOverlayInstruction,
  getRevokeSubscriptionOverlayInstruction,
  getSubscribeOverlayInstructionAsync,
  getSubscriptionAuthorityDecoder,
  getSubscriptionDelegationDecoder,
  getTransferFixedOverlayInstructionAsync,
  getTransferRecurringOverlayInstructionAsync,
  getTransferSubscriptionOverlayInstructionAsync,
  getUpdatePlanOverlayInstruction,
  type FixedDelegation,
  type Plan,
  type RecurringDelegation,
  type SubscriptionAuthority,
  type SubscriptionDelegation,
} from '@solana/subscriptions';
import { base58 } from '@metaplex-foundation/umi/serializers';

import { SPL_TOKEN_PROGRAM_ID } from './delegation.js';

export const NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS = String(PROGRAM_ID);
export const NATIVE_SUBSCRIPTIONS_PROGRAM_ID = publicKey(NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS);

export type NativeSubscriptionPlanStatus = 'active' | 'sunset';

type AddressLike = string | PublicKey;

type BaseNativeArgs = {
  /** SPL mint controlled by this authority/allowance/subscription. */
  mint: AddressLike;
  /** Token program for `mint`. Defaults to classic SPL Token. */
  tokenProgram?: AddressLike;
  /** Program override. Defaults to the canonical native subscriptions program. */
  programAddress?: AddressLike;
};

type PayerArgs = {
  /** Rent/fee payer. Defaults to `umi.payer`. */
  payer?: Signer;
};

type OwnerArgs = {
  /** Token-account owner / subscriber / merchant signer. Defaults to `umi.identity`. */
  owner?: Signer;
};

type AuthorityArgs = {
  /** Signer that can revoke the native record. Defaults to `umi.identity`. */
  authority?: Signer;
};

type CallerArgs = {
  /** Delegatee / merchant / puller signer. Defaults to `umi.identity`. */
  caller?: Signer;
};

export type NativeSubscriptionAuthorityStatus = {
  exists: boolean;
  authority: string;
  owner: string;
  mint: string;
  tokenProgram: string;
  initId: bigint | null;
  data: SubscriptionAuthority | null;
};

export type NativeFixedAllowanceStatus = {
  exists: boolean;
  allowance: string;
  data: FixedDelegation | null;
};

export type NativeRecurringAllowanceStatus = {
  exists: boolean;
  allowance: string;
  data: RecurringDelegation | null;
};

export type NativeSubscriptionPlanStatusResult = {
  exists: boolean;
  plan: string;
  data: Plan | null;
};

export type NativeSubscriptionStatus = {
  exists: boolean;
  subscription: string;
  data: SubscriptionDelegation | null;
};

export type PrepareNativeAuthorityResult = {
  builder: TransactionBuilder;
  authority: string;
  owner: string;
  mint: string;
  tokenProgram: string;
  userTokenAccount: string;
};

export type NativeSendResult = {
  signature: string;
};

export type PrepareNativeAllowanceResult = {
  builder: TransactionBuilder;
  authority: string;
  allowance: string;
  owner: string;
  delegatee: string;
  mint: string;
  tokenProgram: string;
};

export type PrepareNativeTransferResult = {
  builder: TransactionBuilder;
  allowance: string;
  delegator: string;
  caller: string;
  receiverTokenAccount: string;
  mint: string;
  tokenProgram: string;
  amount: bigint;
};

export type PrepareNativePlanResult = {
  builder: TransactionBuilder;
  plan: string;
  owner: string;
  mint: string;
  tokenProgram: string;
  planId: bigint;
};

export type PrepareNativeSubscriptionResult = {
  builder: TransactionBuilder;
  plan: string;
  subscription: string;
  subscriber: string;
  mint: string;
};

export type PrepareNativeSubscriptionCollectResult = {
  builder: TransactionBuilder;
  plan: string;
  subscription: string;
  caller: string;
  delegator: string;
  receiverTokenAccount: string;
  mint: string;
  tokenProgram: string;
  amount: bigint;
};

export type PrepareInitNativeSubscriptionAuthorityArgs = BaseNativeArgs & PayerArgs & OwnerArgs;

export type PrepareCloseNativeSubscriptionAuthorityArgs = BaseNativeArgs &
  OwnerArgs & {
    receiver?: AddressLike;
  };

export type PrepareCreateFixedAllowanceArgs = BaseNativeArgs &
  PayerArgs &
  OwnerArgs & {
    delegatee: AddressLike;
    amount: bigint;
    /** Native-program nonce used to derive this fixed allowance PDA. */
    nonce?: bigint;
    /** Unix timestamp in seconds; `0n` means no expiry. */
    expiryTs?: bigint;
  };

export type PrepareCreateRecurringAllowanceArgs = BaseNativeArgs &
  PayerArgs &
  OwnerArgs & {
    delegatee: AddressLike;
    amountPerPeriod: bigint;
    periodLengthSeconds: bigint;
    startTs?: bigint;
    expiryTs?: bigint;
    nonce?: bigint;
  };

export type PrepareTransferNativeAllowanceArgs = BaseNativeArgs &
  CallerArgs & {
    delegator: AddressLike;
    delegatee?: AddressLike;
    allowance?: AddressLike;
    nonce?: bigint;
    receiver?: AddressLike;
    receiverTokenAccount?: AddressLike;
    amount: bigint;
  };

export type PrepareRevokeNativeAllowanceArgs = AuthorityArgs & {
  allowance: AddressLike;
  receiver?: AddressLike;
  programAddress?: AddressLike;
};

export type PrepareCreateNativePlanArgs = BaseNativeArgs &
  OwnerArgs & {
    planId: bigint;
    amount: bigint;
    periodHours: bigint;
    endTs?: bigint;
    destinations?: AddressLike[];
    pullers?: AddressLike[];
    metadataUri?: string;
  };

export type PrepareUpdateNativePlanArgs = OwnerArgs & {
  plan: AddressLike;
  status: NativeSubscriptionPlanStatus;
  endTs?: bigint;
  pullers?: AddressLike[];
  metadataUri?: string;
  programAddress?: AddressLike;
};

export type PrepareSubscribeNativePlanArgs = BaseNativeArgs &
  PayerArgs &
  OwnerArgs & {
    merchant: AddressLike;
    planId: bigint;
  };

export type PrepareSubscriptionLifecycleArgs = OwnerArgs & {
  plan: AddressLike;
  subscription?: AddressLike;
  subscriber?: AddressLike;
  receiver?: AddressLike;
  programAddress?: AddressLike;
};

export type PrepareCollectNativeSubscriptionArgs = BaseNativeArgs &
  CallerArgs & {
    plan: AddressLike;
    subscription: AddressLike;
    delegator: AddressLike;
    receiver?: AddressLike;
    receiverTokenAccount?: AddressLike;
    amount: bigint;
  };

function toPk(input: AddressLike): PublicKey {
  return typeof input === 'string' ? publicKey(input) : input;
}

function toAddress(input: AddressLike): Address {
  return String(input) as Address;
}

function programAddress(args: { programAddress?: AddressLike }): Address {
  return args.programAddress ? toAddress(args.programAddress) : (PROGRAM_ID as Address);
}

function tokenProgram(args: { tokenProgram?: AddressLike }): PublicKey {
  return args.tokenProgram ? toPk(args.tokenProgram) : SPL_TOKEN_PROGRAM_ID;
}

function tokenProgramAddress(args: { tokenProgram?: AddressLike }): Address {
  return toAddress(tokenProgram(args));
}

function signerAddress(signer: Signer): Address {
  return String(signer.publicKey) as Address;
}

function kitSigner(signer: Signer): TransactionSigner {
  return { address: signerAddress(signer) } as TransactionSigner;
}

function uniqueSigners(signers: Signer[]): Signer[] {
  const seen = new Set<string>();
  const out: Signer[] = [];
  for (const signer of signers) {
    const key = String(signer.publicKey);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signer);
  }
  return out;
}

function convertKitInstruction(ix: KitInstruction, signers: Signer[]): WrappedInstruction {
  const raw = ix as unknown as {
    programAddress: string;
    accounts?: Array<{ address: string; role: number }>;
    data?: Uint8Array;
  };
  const instruction: UmiInstruction = {
    programId: publicKey(raw.programAddress),
    keys: (raw.accounts ?? []).map((account) => ({
      pubkey: publicKey(account.address),
      isSigner: account.role === 2 || account.role === 3,
      isWritable: account.role === 1 || account.role === 3,
    })),
    data: raw.data ? new Uint8Array(raw.data) : new Uint8Array(),
  };
  return {
    instruction,
    signers: uniqueSigners(signers),
    bytesCreatedOnChain: 0,
  };
}

function oneIxBuilder(ix: KitInstruction, signers: Signer[]): TransactionBuilder {
  return transactionBuilder([convertKitInstruction(ix, signers)]);
}

async function sendBuilder(umi: Umi, builder: TransactionBuilder): Promise<NativeSendResult> {
  const result = await builder.sendAndConfirm(umi);
  return { signature: base58.deserialize(result.signature)[0] };
}

async function userAta(
  umi: Umi,
  args: { mint: AddressLike; owner: AddressLike; tokenProgram?: AddressLike },
): Promise<PublicKey> {
  const [ata] = findAssociatedTokenPda(umi, {
    mint: toPk(args.mint),
    owner: toPk(args.owner),
    tokenProgramId: tokenProgram(args),
  });
  return ata;
}

async function receiverAta(
  umi: Umi,
  args: {
    mint: AddressLike;
    tokenProgram?: AddressLike;
    receiver?: AddressLike;
    receiverTokenAccount?: AddressLike;
  },
): Promise<PublicKey> {
  if (args.receiverTokenAccount) return toPk(args.receiverTokenAccount);
  if (!args.receiver) {
    throw new Error('receiver or receiverTokenAccount is required');
  }
  return userAta(umi, { mint: args.mint, owner: args.receiver, tokenProgram: args.tokenProgram });
}

async function subscriptionAuthorityPda(args: {
  owner: AddressLike;
  mint: AddressLike;
  programAddress?: AddressLike;
}): Promise<Address> {
  const [authority] = await findSubscriptionAuthorityPda(
    { user: toAddress(args.owner), tokenMint: toAddress(args.mint) },
    { programAddress: programAddress(args) },
  );
  return authority;
}

async function fixedAllowancePda(args: {
  owner: AddressLike;
  delegatee: AddressLike;
  mint: AddressLike;
  nonce: bigint;
  programAddress?: AddressLike;
}): Promise<Address> {
  const authority = await subscriptionAuthorityPda(args);
  const [allowance] = await findFixedDelegationPda(
    {
      subscriptionAuthority: authority,
      delegator: toAddress(args.owner),
      delegatee: toAddress(args.delegatee),
      nonce: args.nonce,
    },
    { programAddress: programAddress(args) },
  );
  return allowance;
}

async function recurringAllowancePda(args: {
  owner: AddressLike;
  delegatee: AddressLike;
  mint: AddressLike;
  nonce: bigint;
  programAddress?: AddressLike;
}): Promise<Address> {
  const authority = await subscriptionAuthorityPda(args);
  const [allowance] = await findRecurringDelegationPda(
    {
      subscriptionAuthority: authority,
      delegator: toAddress(args.owner),
      delegatee: toAddress(args.delegatee),
      nonce: args.nonce,
    },
    { programAddress: programAddress(args) },
  );
  return allowance;
}

async function planPda(args: {
  owner: AddressLike;
  planId: bigint;
  programAddress?: AddressLike;
}): Promise<Address> {
  const [plan] = await findPlanPda(
    { owner: toAddress(args.owner), planId: args.planId },
    { programAddress: programAddress(args) },
  );
  return plan;
}

async function subscriptionPda(args: {
  plan: AddressLike;
  subscriber: AddressLike;
  programAddress?: AddressLike;
}): Promise<Address> {
  const [subscription] = await findSubscriptionDelegationPda(
    { planPda: toAddress(args.plan), subscriber: toAddress(args.subscriber) },
    { programAddress: programAddress(args) },
  );
  return subscription;
}

async function decodedAccount<T>(
  umi: Umi,
  address: AddressLike,
  decoder: { decode(data: Uint8Array): T },
): Promise<{ exists: false } | { exists: true; data: T }> {
  const account = await umi.rpc.getAccount(toPk(address));
  if (!account.exists) return { exists: false };
  return { exists: true, data: decoder.decode(account.data) };
}

export async function getNativeSubscriptionAuthority(
  umi: Umi,
  args: BaseNativeArgs & { owner?: AddressLike },
): Promise<NativeSubscriptionAuthorityStatus> {
  const owner = args.owner ? toPk(args.owner) : umi.identity.publicKey;
  const authority = await subscriptionAuthorityPda({
    owner,
    mint: args.mint,
    programAddress: args.programAddress,
  });
  const decoded = await decodedAccount(umi, authority, getSubscriptionAuthorityDecoder());
  return {
    exists: decoded.exists,
    authority: String(authority),
    owner: String(owner),
    mint: String(toPk(args.mint)),
    tokenProgram: String(tokenProgram(args)),
    initId: decoded.exists ? decoded.data.initId : null,
    data: decoded.exists ? decoded.data : null,
  };
}

export async function prepareInitNativeSubscriptionAuthority(
  umi: Umi,
  args: PrepareInitNativeSubscriptionAuthorityArgs,
): Promise<PrepareNativeAuthorityResult> {
  const owner = args.owner ?? umi.identity;
  const payer = args.payer ?? umi.payer;
  const mint = toPk(args.mint);
  const tokenProgramPk = tokenProgram(args);
  const ownerAta = await userAta(umi, {
    mint,
    owner: owner.publicKey,
    tokenProgram: tokenProgramPk,
  });
  const authority = await subscriptionAuthorityPda({
    owner: owner.publicKey,
    mint,
    programAddress: args.programAddress,
  });
  const ix = await getInitSubscriptionAuthorityOverlayInstructionAsync({
    owner: kitSigner(owner),
    payer: kitSigner(payer),
    tokenMint: toAddress(mint),
    tokenProgram: toAddress(tokenProgramPk),
    userAta: toAddress(ownerAta),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [owner, payer]),
    authority: String(authority),
    owner: String(owner.publicKey),
    mint: String(mint),
    tokenProgram: String(tokenProgramPk),
    userTokenAccount: String(ownerAta),
  };
}

export async function initNativeSubscriptionAuthority(
  umi: Umi,
  args: PrepareInitNativeSubscriptionAuthorityArgs,
): Promise<PrepareNativeAuthorityResult & NativeSendResult> {
  const prepared = await prepareInitNativeSubscriptionAuthority(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function prepareCloseNativeSubscriptionAuthority(
  umi: Umi,
  args: PrepareCloseNativeSubscriptionAuthorityArgs,
): Promise<PrepareNativeAuthorityResult> {
  const owner = args.owner ?? umi.identity;
  const mint = toPk(args.mint);
  const tokenProgramPk = tokenProgram(args);
  const ownerAta = await userAta(umi, {
    mint,
    owner: owner.publicKey,
    tokenProgram: tokenProgramPk,
  });
  const authority = await subscriptionAuthorityPda({
    owner: owner.publicKey,
    mint,
    programAddress: args.programAddress,
  });
  const ix = await getCloseSubscriptionAuthorityOverlayInstructionAsync({
    user: kitSigner(owner),
    tokenMint: toAddress(mint),
    ...(args.receiver ? { receiver: toAddress(args.receiver) } : {}),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [owner]),
    authority: String(authority),
    owner: String(owner.publicKey),
    mint: String(mint),
    tokenProgram: String(tokenProgramPk),
    userTokenAccount: String(ownerAta),
  };
}

export async function closeNativeSubscriptionAuthority(
  umi: Umi,
  args: PrepareCloseNativeSubscriptionAuthorityArgs,
): Promise<PrepareNativeAuthorityResult & NativeSendResult> {
  const prepared = await prepareCloseNativeSubscriptionAuthority(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function getNativeFixedAllowance(
  umi: Umi,
  args: BaseNativeArgs & { owner: AddressLike; delegatee: AddressLike; nonce?: bigint },
): Promise<NativeFixedAllowanceStatus> {
  const allowance = await fixedAllowancePda({
    owner: args.owner,
    delegatee: args.delegatee,
    mint: args.mint,
    nonce: args.nonce ?? 0n,
    programAddress: args.programAddress,
  });
  const decoded = await decodedAccount(umi, allowance, getFixedDelegationDecoder());
  return {
    exists: decoded.exists,
    allowance: String(allowance),
    data: decoded.exists ? decoded.data : null,
  };
}

export async function prepareCreateNativeFixedAllowance(
  umi: Umi,
  args: PrepareCreateFixedAllowanceArgs,
): Promise<PrepareNativeAllowanceResult> {
  const owner = args.owner ?? umi.identity;
  const payer = args.payer ?? umi.payer;
  const nonce = args.nonce ?? 0n;
  const authority = await getNativeSubscriptionAuthority(umi, {
    owner: owner.publicKey,
    mint: args.mint,
    tokenProgram: args.tokenProgram,
    programAddress: args.programAddress,
  });
  if (!authority.exists || authority.initId == null) {
    throw new Error('SubscriptionAuthority is not initialized for this owner and token mint.');
  }
  const allowance = await fixedAllowancePda({
    owner: owner.publicKey,
    delegatee: args.delegatee,
    mint: args.mint,
    nonce,
    programAddress: args.programAddress,
  });
  const ix = await getCreateFixedDelegationOverlayInstructionAsync({
    delegator: kitSigner(owner),
    payer: kitSigner(payer),
    delegatee: toAddress(args.delegatee),
    amount: args.amount,
    expiryTs: args.expiryTs ?? 0n,
    nonce,
    tokenMint: toAddress(args.mint),
    expectedSubscriptionAuthorityInitId: authority.initId,
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [owner, payer]),
    authority: authority.authority,
    allowance: String(allowance),
    owner: String(owner.publicKey),
    delegatee: String(toPk(args.delegatee)),
    mint: String(toPk(args.mint)),
    tokenProgram: String(tokenProgram(args)),
  };
}

export async function createNativeFixedAllowance(
  umi: Umi,
  args: PrepareCreateFixedAllowanceArgs,
): Promise<PrepareNativeAllowanceResult & NativeSendResult> {
  const prepared = await prepareCreateNativeFixedAllowance(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function prepareTransferNativeFixedAllowance(
  umi: Umi,
  args: PrepareTransferNativeAllowanceArgs,
): Promise<PrepareNativeTransferResult> {
  const caller = args.caller ?? umi.identity;
  const delegatee = args.delegatee ?? caller.publicKey;
  const allowance =
    args.allowance ??
    (await fixedAllowancePda({
      owner: args.delegator,
      delegatee,
      mint: args.mint,
      nonce: args.nonce ?? 0n,
      programAddress: args.programAddress,
    }));
  const rxAta = await receiverAta(umi, args);
  const delegatorAta = await userAta(umi, {
    mint: args.mint,
    owner: args.delegator,
    tokenProgram: args.tokenProgram,
  });
  const ix = await getTransferFixedOverlayInstructionAsync({
    delegatee: kitSigner(caller),
    delegator: toAddress(args.delegator),
    delegatorAta: toAddress(delegatorAta),
    delegationPda: toAddress(allowance),
    amount: args.amount,
    receiverAta: toAddress(rxAta),
    tokenMint: toAddress(args.mint),
    tokenProgram: tokenProgramAddress(args),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [caller]),
    allowance: String(allowance),
    delegator: String(toPk(args.delegator)),
    caller: String(caller.publicKey),
    receiverTokenAccount: String(rxAta),
    mint: String(toPk(args.mint)),
    tokenProgram: String(tokenProgram(args)),
    amount: args.amount,
  };
}

export async function transferNativeFixedAllowance(
  umi: Umi,
  args: PrepareTransferNativeAllowanceArgs,
): Promise<PrepareNativeTransferResult & NativeSendResult> {
  const prepared = await prepareTransferNativeFixedAllowance(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function getNativeRecurringAllowance(
  umi: Umi,
  args: BaseNativeArgs & { owner: AddressLike; delegatee: AddressLike; nonce?: bigint },
): Promise<NativeRecurringAllowanceStatus> {
  const allowance = await recurringAllowancePda({
    owner: args.owner,
    delegatee: args.delegatee,
    mint: args.mint,
    nonce: args.nonce ?? 0n,
    programAddress: args.programAddress,
  });
  const decoded = await decodedAccount(umi, allowance, getRecurringDelegationDecoder());
  return {
    exists: decoded.exists,
    allowance: String(allowance),
    data: decoded.exists ? decoded.data : null,
  };
}

export async function prepareCreateNativeRecurringAllowance(
  umi: Umi,
  args: PrepareCreateRecurringAllowanceArgs,
): Promise<PrepareNativeAllowanceResult> {
  const owner = args.owner ?? umi.identity;
  const payer = args.payer ?? umi.payer;
  const nonce = args.nonce ?? 0n;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const authority = await getNativeSubscriptionAuthority(umi, {
    owner: owner.publicKey,
    mint: args.mint,
    tokenProgram: args.tokenProgram,
    programAddress: args.programAddress,
  });
  if (!authority.exists || authority.initId == null) {
    throw new Error('SubscriptionAuthority is not initialized for this owner and token mint.');
  }
  const allowance = await recurringAllowancePda({
    owner: owner.publicKey,
    delegatee: args.delegatee,
    mint: args.mint,
    nonce,
    programAddress: args.programAddress,
  });
  const ix = await getCreateRecurringDelegationOverlayInstructionAsync({
    delegator: kitSigner(owner),
    payer: kitSigner(payer),
    delegatee: toAddress(args.delegatee),
    amountPerPeriod: args.amountPerPeriod,
    periodLengthS: args.periodLengthSeconds,
    startTs: args.startTs ?? now,
    expiryTs: args.expiryTs ?? 0n,
    nonce,
    tokenMint: toAddress(args.mint),
    expectedSubscriptionAuthorityInitId: authority.initId,
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [owner, payer]),
    authority: authority.authority,
    allowance: String(allowance),
    owner: String(owner.publicKey),
    delegatee: String(toPk(args.delegatee)),
    mint: String(toPk(args.mint)),
    tokenProgram: String(tokenProgram(args)),
  };
}

export async function createNativeRecurringAllowance(
  umi: Umi,
  args: PrepareCreateRecurringAllowanceArgs,
): Promise<PrepareNativeAllowanceResult & NativeSendResult> {
  const prepared = await prepareCreateNativeRecurringAllowance(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function prepareTransferNativeRecurringAllowance(
  umi: Umi,
  args: PrepareTransferNativeAllowanceArgs,
): Promise<PrepareNativeTransferResult> {
  const caller = args.caller ?? umi.identity;
  const delegatee = args.delegatee ?? caller.publicKey;
  const allowance =
    args.allowance ??
    (await recurringAllowancePda({
      owner: args.delegator,
      delegatee,
      mint: args.mint,
      nonce: args.nonce ?? 0n,
      programAddress: args.programAddress,
    }));
  const rxAta = await receiverAta(umi, args);
  const delegatorAta = await userAta(umi, {
    mint: args.mint,
    owner: args.delegator,
    tokenProgram: args.tokenProgram,
  });
  const ix = await getTransferRecurringOverlayInstructionAsync({
    delegatee: kitSigner(caller),
    delegator: toAddress(args.delegator),
    delegatorAta: toAddress(delegatorAta),
    delegationPda: toAddress(allowance),
    amount: args.amount,
    receiverAta: toAddress(rxAta),
    tokenMint: toAddress(args.mint),
    tokenProgram: tokenProgramAddress(args),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [caller]),
    allowance: String(allowance),
    delegator: String(toPk(args.delegator)),
    caller: String(caller.publicKey),
    receiverTokenAccount: String(rxAta),
    mint: String(toPk(args.mint)),
    tokenProgram: String(tokenProgram(args)),
    amount: args.amount,
  };
}

export async function transferNativeRecurringAllowance(
  umi: Umi,
  args: PrepareTransferNativeAllowanceArgs,
): Promise<PrepareNativeTransferResult & NativeSendResult> {
  const prepared = await prepareTransferNativeRecurringAllowance(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export function prepareRevokeNativeAllowance(
  umi: Umi,
  args: PrepareRevokeNativeAllowanceArgs,
): PrepareNativeTransferResult {
  const authority = args.authority ?? umi.identity;
  const ix = getRevokeDelegationOverlayInstruction({
    authority: kitSigner(authority),
    delegationAccount: toAddress(args.allowance),
    ...(args.receiver ? { receiver: toAddress(args.receiver) } : {}),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [authority]),
    allowance: String(toPk(args.allowance)),
    delegator: '',
    caller: String(authority.publicKey),
    receiverTokenAccount: args.receiver ? String(toPk(args.receiver)) : '',
    mint: '',
    tokenProgram: '',
    amount: 0n,
  };
}

export async function revokeNativeAllowance(
  umi: Umi,
  args: PrepareRevokeNativeAllowanceArgs,
): Promise<PrepareNativeTransferResult & NativeSendResult> {
  const prepared = prepareRevokeNativeAllowance(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function getNativeSubscriptionPlan(
  umi: Umi,
  args: { owner: AddressLike; planId: bigint; programAddress?: AddressLike },
): Promise<NativeSubscriptionPlanStatusResult> {
  const plan = await planPda(args);
  const decoded = await decodedAccount(umi, plan, getPlanDecoder());
  return {
    exists: decoded.exists,
    plan: String(plan),
    data: decoded.exists ? decoded.data : null,
  };
}

export async function prepareCreateNativeSubscriptionPlan(
  umi: Umi,
  args: PrepareCreateNativePlanArgs,
): Promise<PrepareNativePlanResult> {
  const owner = args.owner ?? umi.identity;
  const plan = await planPda({ owner: owner.publicKey, planId: args.planId });
  const ix = await getCreatePlanOverlayInstructionAsync({
    owner: kitSigner(owner),
    planId: args.planId,
    mint: toAddress(args.mint),
    tokenProgram: tokenProgramAddress(args),
    amount: args.amount,
    periodHours: args.periodHours,
    endTs: args.endTs ?? 0n,
    destinations: (args.destinations ?? [owner.publicKey]).map(toAddress),
    pullers: (args.pullers ?? [owner.publicKey]).map(toAddress),
    metadataUri: args.metadataUri ?? '',
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [owner]),
    plan: String(plan),
    owner: String(owner.publicKey),
    mint: String(toPk(args.mint)),
    tokenProgram: String(tokenProgram(args)),
    planId: args.planId,
  };
}

export async function createNativeSubscriptionPlan(
  umi: Umi,
  args: PrepareCreateNativePlanArgs,
): Promise<PrepareNativePlanResult & NativeSendResult> {
  const prepared = await prepareCreateNativeSubscriptionPlan(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export function prepareUpdateNativeSubscriptionPlan(
  umi: Umi,
  args: PrepareUpdateNativePlanArgs,
): PrepareNativePlanResult {
  const owner = args.owner ?? umi.identity;
  const ix = getUpdatePlanOverlayInstruction({
    owner: kitSigner(owner),
    planPda: toAddress(args.plan),
    status: args.status === 'active' ? PlanStatus.Active : PlanStatus.Sunset,
    endTs: args.endTs ?? 0n,
    pullers: (args.pullers ?? []).map(toAddress),
    metadataUri: args.metadataUri ?? '',
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [owner]),
    plan: String(toPk(args.plan)),
    owner: String(owner.publicKey),
    mint: '',
    tokenProgram: '',
    planId: 0n,
  };
}

export async function updateNativeSubscriptionPlan(
  umi: Umi,
  args: PrepareUpdateNativePlanArgs,
): Promise<PrepareNativePlanResult & NativeSendResult> {
  const prepared = prepareUpdateNativeSubscriptionPlan(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function getNativeSubscription(
  umi: Umi,
  args: { plan: AddressLike; subscriber: AddressLike; programAddress?: AddressLike },
): Promise<NativeSubscriptionStatus> {
  const subscription = await subscriptionPda(args);
  const decoded = await decodedAccount(umi, subscription, getSubscriptionDelegationDecoder());
  return {
    exists: decoded.exists,
    subscription: String(subscription),
    data: decoded.exists ? decoded.data : null,
  };
}

export async function prepareSubscribeNativeSubscriptionPlan(
  umi: Umi,
  args: PrepareSubscribeNativePlanArgs,
): Promise<PrepareNativeSubscriptionResult> {
  const subscriber = args.owner ?? umi.identity;
  const payer = args.payer ?? umi.payer;
  const planStatus = await getNativeSubscriptionPlan(umi, {
    owner: args.merchant,
    planId: args.planId,
    programAddress: args.programAddress,
  });
  if (!planStatus.exists || !planStatus.data) {
    throw new Error('Subscription plan does not exist.');
  }
  const authority = await getNativeSubscriptionAuthority(umi, {
    owner: subscriber.publicKey,
    mint: args.mint,
    tokenProgram: args.tokenProgram,
    programAddress: args.programAddress,
  });
  if (!authority.exists || authority.initId == null) {
    throw new Error('SubscriptionAuthority is not initialized for this subscriber and token mint.');
  }
  const subscription = await subscriptionPda({
    plan: planStatus.plan,
    subscriber: subscriber.publicKey,
    programAddress: args.programAddress,
  });
  const ix = await getSubscribeOverlayInstructionAsync({
    subscriber: kitSigner(subscriber),
    payer: kitSigner(payer),
    merchant: toAddress(args.merchant),
    planId: args.planId,
    tokenMint: toAddress(args.mint),
    expectedAmount: planStatus.data.data.terms.amount,
    expectedPeriodHours: planStatus.data.data.terms.periodHours,
    expectedCreatedAt: planStatus.data.data.terms.createdAt,
    expectedSubscriptionAuthorityInitId: authority.initId,
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [subscriber, payer]),
    plan: planStatus.plan,
    subscription: String(subscription),
    subscriber: String(subscriber.publicKey),
    mint: String(toPk(args.mint)),
  };
}

export async function subscribeNativeSubscriptionPlan(
  umi: Umi,
  args: PrepareSubscribeNativePlanArgs,
): Promise<PrepareNativeSubscriptionResult & NativeSendResult> {
  const prepared = await prepareSubscribeNativeSubscriptionPlan(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function prepareCancelNativeSubscription(
  umi: Umi,
  args: PrepareSubscriptionLifecycleArgs,
): Promise<PrepareNativeSubscriptionResult> {
  const subscriber = args.owner ?? umi.identity;
  const subscription =
    args.subscription ??
    (await subscriptionPda({
      plan: args.plan,
      subscriber: args.subscriber ?? subscriber.publicKey,
      programAddress: args.programAddress,
    }));
  const ix = await getCancelSubscriptionOverlayInstructionAsync({
    subscriber: kitSigner(subscriber),
    planPda: toAddress(args.plan),
    subscriptionPda: toAddress(subscription),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [subscriber]),
    plan: String(toPk(args.plan)),
    subscription: String(toPk(subscription)),
    subscriber: String(subscriber.publicKey),
    mint: '',
  };
}

export async function cancelNativeSubscription(
  umi: Umi,
  args: PrepareSubscriptionLifecycleArgs,
): Promise<PrepareNativeSubscriptionResult & NativeSendResult> {
  const prepared = await prepareCancelNativeSubscription(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function prepareResumeNativeSubscription(
  umi: Umi,
  args: PrepareSubscriptionLifecycleArgs,
): Promise<PrepareNativeSubscriptionResult> {
  const subscriber = args.owner ?? umi.identity;
  const subscription =
    args.subscription ??
    (await subscriptionPda({
      plan: args.plan,
      subscriber: args.subscriber ?? subscriber.publicKey,
      programAddress: args.programAddress,
    }));
  const ix = await getResumeSubscriptionOverlayInstructionAsync({
    subscriber: kitSigner(subscriber),
    planPda: toAddress(args.plan),
    subscriptionPda: toAddress(subscription),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [subscriber]),
    plan: String(toPk(args.plan)),
    subscription: String(toPk(subscription)),
    subscriber: String(subscriber.publicKey),
    mint: '',
  };
}

export async function resumeNativeSubscription(
  umi: Umi,
  args: PrepareSubscriptionLifecycleArgs,
): Promise<PrepareNativeSubscriptionResult & NativeSendResult> {
  const prepared = await prepareResumeNativeSubscription(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export function prepareRevokeNativeSubscription(
  umi: Umi,
  args: PrepareSubscriptionLifecycleArgs,
): PrepareNativeSubscriptionResult {
  const authority = args.owner ?? umi.identity;
  if (!args.subscription) throw new Error('subscription is required');
  const ix = getRevokeSubscriptionOverlayInstruction({
    authority: kitSigner(authority),
    planPda: toAddress(args.plan),
    subscriptionPda: toAddress(args.subscription),
    ...(args.receiver ? { receiver: toAddress(args.receiver) } : {}),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [authority]),
    plan: String(toPk(args.plan)),
    subscription: String(toPk(args.subscription)),
    subscriber: String(authority.publicKey),
    mint: '',
  };
}

export async function revokeNativeSubscription(
  umi: Umi,
  args: PrepareSubscriptionLifecycleArgs,
): Promise<PrepareNativeSubscriptionResult & NativeSendResult> {
  const prepared = prepareRevokeNativeSubscription(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

export async function prepareCollectNativeSubscription(
  umi: Umi,
  args: PrepareCollectNativeSubscriptionArgs,
): Promise<PrepareNativeSubscriptionCollectResult> {
  const caller = args.caller ?? umi.identity;
  const rxAta = await receiverAta(umi, args);
  const ix = await getTransferSubscriptionOverlayInstructionAsync({
    caller: kitSigner(caller),
    delegator: toAddress(args.delegator),
    planPda: toAddress(args.plan),
    subscriptionPda: toAddress(args.subscription),
    receiverAta: toAddress(rxAta),
    amount: args.amount,
    tokenMint: toAddress(args.mint),
    tokenProgram: tokenProgramAddress(args),
    programAddress: programAddress(args),
  });
  return {
    builder: oneIxBuilder(ix, [caller]),
    plan: String(toPk(args.plan)),
    subscription: String(toPk(args.subscription)),
    caller: String(caller.publicKey),
    delegator: String(toPk(args.delegator)),
    receiverTokenAccount: String(rxAta),
    mint: String(toPk(args.mint)),
    tokenProgram: String(tokenProgram(args)),
    amount: args.amount,
  };
}

export async function collectNativeSubscription(
  umi: Umi,
  args: PrepareCollectNativeSubscriptionArgs,
): Promise<PrepareNativeSubscriptionCollectResult & NativeSendResult> {
  const prepared = await prepareCollectNativeSubscription(umi, args);
  return { ...prepared, ...(await sendBuilder(umi, prepared.builder)) };
}

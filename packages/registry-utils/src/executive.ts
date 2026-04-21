/**
 * Executive registration + execution delegation for `mpl-agent-tools`.
 *
 * Mirrors the Metaplex "Run an Agent" guide:
 *   https://www.metaplex.com/docs/agents/run-an-agent
 *
 * Flow:
 *   1. `registerExecutive(umi)` — one-time per wallet. Creates an
 *      `ExecutiveProfileV1` PDA derived from `["executive_profile", authority]`.
 *   2. `delegateExecution(umi, { agentAsset, executiveAuthority })` — the
 *      asset owner links their agent to a registered executive.
 *   3. `verifyDelegation(umi, { agentAsset, executiveAuthority })` — checks
 *      the on-chain `ExecutionDelegateRecordV1` PDA.
 *
 * After delegation lands, the executive can sign Core `Execute` instructions
 * on the agent's behalf without further owner involvement.
 */
import {
  registerExecutiveV1,
  delegateExecutionV1,
  findAgentIdentityV1Pda,
  findExecutiveProfileV1Pda,
  findExecutionDelegateRecordV1Pda,
  safeFetchExecutiveProfileV1FromSeeds,
} from '@metaplex-foundation/mpl-agent-registry';
import type { PublicKey, Signer, Umi } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

/**
 * Register the caller as an Executive in the `mpl-agent-tools` program.
 * One-time setup per wallet — the PDA is derived from
 * `["executive_profile", <authority>]`, so calling twice with the same
 * authority fails on-chain.
 *
 * Defaults match the Metaplex docs snippet (`payer: umi.payer`). Override
 * `payer` or `authority` when the rent payer and the executive owner are
 * different signers (e.g. relayer pays, hardware wallet authorises).
 *
 * @see https://www.metaplex.com/docs/agents/run-an-agent#register-an-executive-profile
 */
export async function registerExecutive(
  umi: Umi,
  opts?: { payer?: Signer; authority?: Signer },
): Promise<{ signature: string; profile: string }> {
  const payer = opts?.payer ?? umi.payer;
  const authority = opts?.authority;
  const result = await registerExecutiveV1(umi, {
    payer,
    ...(authority ? { authority } : {}),
  }).sendAndConfirm(umi);
  const authorityKey = authority?.publicKey ?? umi.identity.publicKey;
  const [profile] = findExecutiveProfileV1Pda(umi, { authority: authorityKey });
  return { signature: base58.deserialize(result.signature)[0], profile: String(profile) };
}

/** Returns true if an executive profile is already registered for the wallet. */
export async function hasExecutiveProfile(
  umi: Umi,
  authority: string | PublicKey,
): Promise<boolean> {
  const auth = typeof authority === 'string' ? publicKey(authority) : authority;
  const account = await safeFetchExecutiveProfileV1FromSeeds(umi, { authority: auth });
  return account != null;
}

/**
 * The asset owner delegates execution of an agent to a registered executive.
 * Creates an on-chain `ExecutionDelegateRecordV1` PDA derived from
 * `["execution_delegate_record", <executiveProfile>, <agentAsset>]`.
 *
 * The signer (default `umi.identity`) **must be the asset owner** — the
 * program rejects the tx otherwise. Pass `authority` explicitly when the
 * owner is a different signer than `umi.identity` (e.g. multisig, hardware
 * wallet) and `payer` when rent comes from a relayer.
 *
 * @see https://www.metaplex.com/docs/agents/run-an-agent#delegate-execution
 */
export async function delegateExecution(
  umi: Umi,
  args: {
    agentAsset: string | PublicKey;
    executiveAuthority: string | PublicKey;
    payer?: Signer;
    authority?: Signer;
  },
): Promise<{ signature: string; delegateRecord: string }> {
  const asset = typeof args.agentAsset === 'string' ? publicKey(args.agentAsset) : args.agentAsset;
  const authorityKey =
    typeof args.executiveAuthority === 'string'
      ? publicKey(args.executiveAuthority)
      : args.executiveAuthority;

  const [agentIdentity] = findAgentIdentityV1Pda(umi, { asset });
  const [executiveProfile] = findExecutiveProfileV1Pda(umi, { authority: authorityKey });

  const result = await delegateExecutionV1(umi, {
    agentAsset: asset,
    agentIdentity,
    executiveProfile,
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.authority ? { authority: args.authority } : {}),
  }).sendAndConfirm(umi);

  const [delegateRecord] = findExecutionDelegateRecordV1Pda(umi, {
    executiveProfile,
    agentAsset: asset,
  });
  return {
    signature: base58.deserialize(result.signature)[0],
    delegateRecord: String(delegateRecord),
  };
}

/**
 * Verify that an `ExecutionDelegateRecordV1` exists for the given
 * (executive, agent) pair. Mirrors the docs' "Verify Delegation" snippet:
 * derive the PDA, fetch the account, return `account.exists`.
 *
 * Returns the derived `delegateRecord` PDA alongside the `exists` flag so
 * callers can deep-link to a block explorer without re-deriving.
 *
 * @see https://www.metaplex.com/docs/agents/run-an-agent#verify-delegation
 */
export async function verifyDelegation(
  umi: Umi,
  args: { agentAsset: string | PublicKey; executiveAuthority: string | PublicKey },
): Promise<{ delegateRecord: string; exists: boolean }> {
  const asset = typeof args.agentAsset === 'string' ? publicKey(args.agentAsset) : args.agentAsset;
  const authority =
    typeof args.executiveAuthority === 'string'
      ? publicKey(args.executiveAuthority)
      : args.executiveAuthority;
  const [executiveProfile] = findExecutiveProfileV1Pda(umi, { authority });
  const [delegateRecord] = findExecutionDelegateRecordV1Pda(umi, {
    executiveProfile,
    agentAsset: asset,
  });
  const account = await umi.rpc.getAccount(delegateRecord);
  return { delegateRecord: String(delegateRecord), exists: account.exists };
}

/**
 * Boolean shortcut around {@link verifyDelegation}. Kept for back-compat —
 * new code should prefer `verifyDelegation` so the `delegateRecord` PDA is
 * available alongside the existence flag.
 */
export async function isExecutionDelegated(
  umi: Umi,
  args: { agentAsset: string | PublicKey; executiveAuthority: string | PublicKey },
): Promise<boolean> {
  const { exists } = await verifyDelegation(umi, args);
  return exists;
}

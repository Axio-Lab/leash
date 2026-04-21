import {
  registerExecutiveV1,
  delegateExecutionV1,
  findAgentIdentityV1Pda,
  findExecutiveProfileV1Pda,
  findExecutionDelegateRecordV1Pda,
  safeFetchExecutiveProfileV1FromSeeds,
} from '@metaplex-foundation/mpl-agent-registry';
import type { PublicKey, Umi } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

/**
 * Register the caller (`umi.identity`) as an Executive in the
 * `mpl-agent-tools` program. One-time setup per wallet — the PDA is derived
 * from `["executive_profile", <authority>]`, so calling twice fails.
 */
export async function registerExecutive(umi: Umi): Promise<{ signature: string; profile: string }> {
  const result = await registerExecutiveV1(umi, {}).sendAndConfirm(umi);
  const [profile] = findExecutiveProfileV1Pda(umi, { authority: umi.identity.publicKey });
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
 * Creates an on-chain `ExecutionDelegateRecordV1` PDA. After this lands the
 * executive can sign Core `Execute` instructions on the agent's behalf
 * without further owner involvement.
 */
export async function delegateExecution(
  umi: Umi,
  args: { agentAsset: string | PublicKey; executiveAuthority: string | PublicKey },
): Promise<{ signature: string; delegateRecord: string }> {
  const asset = typeof args.agentAsset === 'string' ? publicKey(args.agentAsset) : args.agentAsset;
  const authority =
    typeof args.executiveAuthority === 'string'
      ? publicKey(args.executiveAuthority)
      : args.executiveAuthority;

  const [agentIdentity] = findAgentIdentityV1Pda(umi, { asset });
  const [executiveProfile] = findExecutiveProfileV1Pda(umi, { authority });

  const result = await delegateExecutionV1(umi, {
    agentAsset: asset,
    agentIdentity,
    executiveProfile,
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

/** Returns whether an `ExecutionDelegateRecordV1` exists for this (executive, agent) pair. */
export async function isExecutionDelegated(
  umi: Umi,
  args: { agentAsset: string | PublicKey; executiveAuthority: string | PublicKey },
): Promise<boolean> {
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
  return account.exists;
}

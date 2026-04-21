import { registerIdentityV1 } from '@metaplex-foundation/mpl-agent-registry';
import type { PublicKey, Umi } from '@metaplex-foundation/umi';

export type RegisterIdentityArgs = {
  asset: PublicKey;
  collection: PublicKey;
  agentRegistrationUri: string;
};

export async function registerAgentIdentity(umi: Umi, args: RegisterIdentityArgs): Promise<void> {
  await registerIdentityV1(umi, {
    asset: args.asset,
    collection: args.collection,
    agentRegistrationUri: args.agentRegistrationUri,
  }).sendAndConfirm(umi);
}

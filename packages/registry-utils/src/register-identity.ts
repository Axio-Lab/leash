import { registerIdentityV1 } from '@metaplex-foundation/mpl-agent-registry';
import type { PublicKey, Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

export type RegisterIdentityArgs = {
  asset: PublicKey;
  collection: PublicKey;
  agentRegistrationUri: string;
};

export type PrepareRegisterAgentIdentityResult = {
  /**
   * Unsigned `registerIdentityV1` transaction builder. Serialize via
   * `umi.transactions.serialize(builder.build(umi))` to hand the bytes to
   * a remote signer (HTTP API caller, hardware wallet, etc.).
   */
  builder: ReturnType<typeof registerIdentityV1>;
  /** Echo of the agent asset address. */
  asset: string;
  /** Echo of the collection address. */
  collection: string;
  /** Echo of the registration URI that will be written on-chain. */
  agentRegistrationUri: string;
};

/**
 * Build the `registerIdentityV1` instruction without sending it. Useful for
 * HTTP / remote-signer flows where the on-chain submission happens in a
 * different process than the one assembling the transaction.
 *
 * Pair with `umi.transactions.serialize(builder.build(umi))` to get the raw
 * bytes the caller signs, or call `builder.sendAndConfirm(umi)` directly
 * (which is what {@link registerAgentIdentity} does).
 */
export async function prepareRegisterAgentIdentity(
  umi: Umi,
  args: RegisterIdentityArgs,
): Promise<PrepareRegisterAgentIdentityResult> {
  const builder = registerIdentityV1(umi, {
    asset: args.asset,
    collection: args.collection,
    agentRegistrationUri: args.agentRegistrationUri,
  });
  return {
    builder,
    asset: String(args.asset),
    collection: String(args.collection),
    agentRegistrationUri: args.agentRegistrationUri,
  };
}

export type RegisterAgentIdentityResult = {
  /** Base58 transaction signature. */
  signature: string;
  /** Echo of the agent asset address. */
  asset: string;
  /** Echo of the collection address. */
  collection: string;
  /** Echo of the registration URI that was written on-chain. */
  agentRegistrationUri: string;
};

export async function registerAgentIdentity(
  umi: Umi,
  args: RegisterIdentityArgs,
): Promise<RegisterAgentIdentityResult> {
  const prepared = await prepareRegisterAgentIdentity(umi, args);
  const result = await prepared.builder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    asset: prepared.asset,
    collection: prepared.collection,
    agentRegistrationUri: prepared.agentRegistrationUri,
  };
}

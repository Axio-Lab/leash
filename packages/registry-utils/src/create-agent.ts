import {
  mintAndSubmitAgent,
  mintAgent,
  signAndSendAgentTransaction,
  type AgentApiConfig,
  type AgentMetadata,
  type AgentRegistration,
  type AgentService,
  type MintAgentResponse,
  type SvmNetwork,
} from '@metaplex-foundation/mpl-agent-registry';
import type { Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

/**
 * Input for {@link createAgent} / {@link prepareAgentMint}. Mirrors Metaplex's
 * `MintAgentInput` but lets the caller pass a partial `agentMetadata` (we'll
 * fill in `type: 'agent'` and copy `name`/`description` from the top level
 * when omitted, matching the docs example).
 */
export type CreateAgentInput = {
  wallet: string;
  network?: SvmNetwork;
  name: string;
  /** NFT-style metadata URI stored on-chain. */
  uri: string;
  description: string;
  services?: AgentService[];
  registrations?: AgentRegistration[];
  supportedTrust?: string[];
  /** Override default `type: 'agent'` schema id if you need a custom one. */
  type?: string;
};

export type CreateAgentResult = {
  assetAddress: string;
  /** Base58-encoded transaction signature. */
  signature: string;
  network: SvmNetwork;
};

function buildMetadata(input: CreateAgentInput): AgentMetadata {
  return {
    type: input.type ?? 'agent',
    name: input.name,
    description: input.description,
    services: input.services ?? [],
    registrations: input.registrations ?? [],
    supportedTrust: input.supportedTrust ?? [],
  };
}

/**
 * One-shot create: mints a new MPL Core asset and registers its Agent
 * Identity in a single transaction via the Metaplex API
 * (`POST https://api.metaplex.com/v1/agents/mint`). The wallet provided in
 * `umi.identity` pays for the transaction and becomes the agent owner.
 *
 * This is the recommended path for new agents (see Metaplex docs:
 * "Mint an Agent"). For attaching identity to an existing Core asset, use
 * {@link registerAgentIdentity} from `./register-identity`.
 */
export async function createAgent(
  umi: Umi,
  input: CreateAgentInput,
  config?: AgentApiConfig,
): Promise<CreateAgentResult> {
  const network = input.network ?? 'solana-devnet';
  const result = await mintAndSubmitAgent(umi, config ?? null, {
    wallet: input.wallet,
    network,
    name: input.name,
    uri: input.uri,
    agentMetadata: buildMetadata(input),
  });
  return {
    assetAddress: result.assetAddress,
    signature: base58.deserialize(result.signature)[0],
    network,
  };
}

/**
 * Two-step variant: returns the unsigned transaction + pre-computed asset
 * address so callers can add priority fees, use a hardware wallet, or
 * inspect the tx before submitting. Pair with {@link sendPreparedAgentMint}.
 */
export async function prepareAgentMint(
  umi: Umi,
  input: CreateAgentInput,
  config?: AgentApiConfig,
): Promise<MintAgentResponse & { network: SvmNetwork }> {
  const network = input.network ?? 'solana-devnet';
  const res = await mintAgent(umi, config ?? null, {
    wallet: input.wallet,
    network,
    name: input.name,
    uri: input.uri,
    agentMetadata: buildMetadata(input),
  });
  return { ...res, network };
}

/** Submit a transaction returned by {@link prepareAgentMint}. */
export async function sendPreparedAgentMint(
  umi: Umi,
  prepared: MintAgentResponse,
): Promise<string> {
  const sig = await signAndSendAgentTransaction(umi, prepared);
  return base58.deserialize(sig)[0];
}

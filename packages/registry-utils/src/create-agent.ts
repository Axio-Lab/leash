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
  /**
   * Receipt feed disclosure on the agent's on-chain `services` block.
   * By default Leash injects a `services` entry of the form
   * `{ name: 'receipts', endpoint: '<resolved-url>' }` so the explorer
   * (and any other indexer) can self-discover where to pull this
   * agent's receipts from.
   *
   * Resolution precedence:
   *   1. `receiptsUrl: '...'`   (explicit override; used as-is)
   *   2. `LEASH_RECEIPTS_URL`   (env override; useful for staging)
   *   3. `https://api.leash.market/v1/receipts/{agent}` (default)
   *
   * Pass `receiptsUrl: false` (or `LEASH_NO_RECEIPTS_URL=1`) to skip
   * the injection entirely — typically only needed for self-hosted
   * deployments that don't run the Leash API.
   *
   * If the caller already includes a `services[]` entry whose `name`
   * is `'receipts'`, the auto-inject is skipped (caller wins).
   */
  receiptsUrl?: string | false;
};

export type CreateAgentResult = {
  assetAddress: string;
  /** Base58-encoded transaction signature. */
  signature: string;
  network: SvmNetwork;
};

/**
 * Default URL pattern published as `services.receipts.endpoint` so any
 * indexer or explorer can discover where to pull receipts from. The
 * literal `{agent}` placeholder is left in place: clients substitute
 * the freshly-minted asset address client-side. This avoids needing to
 * know the asset address at metadata-build time (it's only finalised
 * by Metaplex during `mintAgent`).
 */
const DEFAULT_RECEIPTS_URL_TEMPLATE = 'https://api.leash.market/v1/receipts/{agent}';

function resolveReceiptsUrl(input: CreateAgentInput): string | null {
  if (input.receiptsUrl === false) return null;
  if (typeof input.receiptsUrl === 'string' && input.receiptsUrl.length > 0) {
    return input.receiptsUrl;
  }
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.LEASH_NO_RECEIPTS_URL === '1') return null;
    if (process.env.LEASH_RECEIPTS_URL) return process.env.LEASH_RECEIPTS_URL;
  }
  return DEFAULT_RECEIPTS_URL_TEMPLATE;
}

function buildMetadata(input: CreateAgentInput): AgentMetadata {
  const userServices = input.services ?? [];
  const callerHasReceipts = userServices.some((s) => s.name === 'receipts');
  const receiptsUrl = callerHasReceipts ? null : resolveReceiptsUrl(input);
  const services: AgentService[] = receiptsUrl
    ? [...userServices, { name: 'receipts', endpoint: receiptsUrl }]
    : userServices;
  return {
    type: input.type ?? 'agent',
    name: input.name,
    description: input.description,
    services,
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

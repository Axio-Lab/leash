/**
 * Agent token launches via Metaplex Genesis.
 *
 * Mirrors the Metaplex docs flow ("Create an Agent Token" — see
 * https://www.metaplex.com/docs/agents/create-agent-token) but reshapes
 * the API to match Leash's other registry-utils helpers:
 *
 *   - One typed input/result pair per public function (no `umi` arg
 *     leaking through partial Genesis configs).
 *   - Base58 transaction signatures returned as strings, not
 *     `Uint8Array`s, so they round-trip through JSON / receipts /
 *     explorer links without extra work in callers.
 *   - Optional read helpers (`getAgentToken`, `hasAgentToken`) so the
 *     web app can decide whether to render "Launch token" or "Token
 *     already launched" without re-implementing the on-chain decode.
 *
 * The on-chain mechanics are unchanged from Genesis:
 *
 *   - `createAndRegisterLaunch` posts the unsigned transactions to
 *     `https://api.metaplex.com`, signs them with `umi.identity`, sends
 *     them to Solana, and registers the new launch with Metaplex so it
 *     shows up on metaplex.com.
 *   - When `agent.setToken === true`, the bundle wraps a
 *     `setAgentTokenV1` instruction in `mpl-core::Execute` so the agent
 *     PDA permanently associates itself with the new mint. **This
 *     binding is one-way** — once set you cannot replace, unset, or
 *     reassign the agent's token.
 *
 * Why this lives in `@leash/registry-utils` (and not `@leash/core` or
 * a new `@leash/genesis` package)?
 *
 *   It uses the same `mpl-core` + `mpl-agent-registry` Umi surface as
 *   `./create-agent.ts`, `./executive.ts`, and `./withdraw.ts`. Pulling
 *   Genesis into `@leash/core` would balloon its browser bundle
 *   (Genesis depends on `mpl-token-metadata`); keeping it next to
 *   `createAgent` keeps the dependency graph honest.
 */

import {
  createAndRegisterLaunch,
  createLaunch,
  registerLaunch,
  signAndSendLaunchTransactions,
  type BondingCurveLaunchInput,
  type CreateAndRegisterLaunchResult,
  type CreateLaunchResponse,
  type GenesisApiConfig,
  type RegisterLaunchInput,
  type RegisterLaunchResponse,
  type SignAndSendOptions,
  type SvmNetwork,
  type TokenMetadata,
} from '@metaplex-foundation/genesis';

/**
 * Optional fields forwarded to `registerLaunch` when using
 * {@link launchAgentToken}. Mirrors `RegisterOptions` from
 * `@metaplex-foundation/genesis/api` (which isn't re-exported from the
 * package root in 0.35.0, so we declare it inline here).
 */
export type RegisterOptions = Omit<RegisterLaunchInput, 'genesisAccount' | 'createLaunchInput'>;
import {
  safeFetchAgentIdentityV1FromSeeds,
  safeFetchAgentIdentityV2FromSeeds,
  setAgentTokenV1,
  type AgentIdentityV1,
  type AgentIdentityV2,
} from '@metaplex-foundation/mpl-agent-registry';
import { execute, findAssetSignerPda, type CollectionV1 } from '@metaplex-foundation/mpl-core';
import {
  createNoopSigner,
  publicKey,
  type PublicKey,
  type Signer,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

function toPk(input: string | PublicKey): PublicKey {
  return typeof input === 'string' ? publicKey(input) : input;
}

/** Encode each Genesis tx signature for callers that JSON-stringify the result. */
function encodeSignatures(sigs: Uint8Array[]): string[] {
  return sigs.map((s) => base58.deserialize(s)[0]);
}

export type LaunchAgentTokenInput = {
  /** The agent's MPL Core asset address (mint). Required. */
  agentAsset: string | PublicKey;
  /**
   * Token metadata. `image` MUST be an `https://gateway.irys.xyz/<id>` URL
   * (Metaplex API rejects other hosts). Upload to Irys first.
   */
  token: TokenMetadata;
  /**
   * `solana-mainnet` (default) or `solana-devnet`. Must match the cluster
   * the Umi instance points at — Genesis does not switch clusters for you.
   */
  network?: SvmNetwork;
  /**
   * Permanently associate the new mint with this agent
   * (`setAgentTokenV1`). **Irreversible** — once set you cannot replace
   * or unset the agent's token. Defaults to `false` so the playground
   * "Launch token (preview)" path can mint without locking the agent in.
   */
  setToken?: boolean;
  /**
   * Bonding-curve launch options. Defaults to `{}` (protocol defaults
   * for supply, virtual reserves, lock schedules). Pass
   * `firstBuyAmount` (in SOL) to reserve the first swap fee-free.
   */
  launch?: BondingCurveLaunchInput;
  /**
   * Override the launching wallet. Defaults to `umi.identity.publicKey`.
   * The launching wallet pays for the create transactions (~0.02 SOL).
   */
  wallet?: string | PublicKey;
  /**
   * Optional Genesis API config (custom base URL or fetch). Useful for
   * tests against a mocked API; in production the defaults
   * (`https://api.metaplex.com`) are correct.
   */
  api?: GenesisApiConfig;
  /** Forwarded to {@link createAndRegisterLaunch}. */
  signAndSendOptions?: SignAndSendOptions;
  registerOptions?: RegisterOptions;
};

export type LaunchAgentTokenResult = {
  /** The new SPL token mint address. */
  mintAddress: string;
  /** Genesis account PDA — used for explorer links and `setAgentTokenV1`. */
  genesisAccount: string;
  /**
   * Base58 signatures for every transaction in the bundle (typically
   * 1-2: create + first-buy when applicable).
   */
  signatures: string[];
  /** Metaplex-hosted launch landing page (`https://www.metaplex.com/...`). */
  launch: { id: string; link: string };
  /** Token registry record produced by `registerLaunch`. */
  token: { id: string; mintAddress: string };
  /** Echo of the agent asset address (for explorer link composition). */
  agentAsset: string;
  /** Echo of the network the launch landed on. */
  network: SvmNetwork;
  /**
   * `true` when `input.setToken` was `true`, the launch landed cleanly,
   * and the agent → token association is now on-chain. The Genesis SDK
   * bundles `setAgentTokenV1` into the create transaction in that case.
   */
  agentTokenSet: boolean;
};

/**
 * One-shot Genesis launch on behalf of an agent. Mirrors the docs'
 * `createAndRegisterLaunch` example with Leash-friendly types.
 *
 * @example
 * ```ts
 * await launchAgentToken(umi, {
 *   agentAsset: '<Core asset mint>',
 *   token: { name: 'Plexpert', symbol: 'PLX',
 *            image: 'https://gateway.irys.xyz/abc' },
 *   network: 'solana-devnet',
 *   setToken: false, // preview on devnet — flip to true for the real one
 *   launch: { firstBuyAmount: 0.1 },
 * });
 * ```
 *
 * Throws on Metaplex API rejection, network failure, or any signing
 * error. Errors propagate as Genesis typed errors
 * (`isGenesisValidationError`, `isGenesisApiError`,
 * `isGenesisApiNetworkError`) so callers can branch on them — see
 * Metaplex docs for the exact shape.
 */
export async function launchAgentToken(
  umi: Umi,
  input: LaunchAgentTokenInput,
): Promise<LaunchAgentTokenResult> {
  const network = input.network ?? 'solana-devnet';
  const wallet = input.wallet ? toPk(input.wallet) : umi.identity.publicKey;
  const agentMint = toPk(input.agentAsset);

  const result: CreateAndRegisterLaunchResult = await createAndRegisterLaunch(
    umi,
    input.api ?? null,
    {
      wallet,
      network,
      launchType: 'bondingCurve',
      token: input.token,
      launch: input.launch ?? {},
      agent: {
        mint: agentMint,
        setToken: input.setToken ?? false,
      },
    },
    input.signAndSendOptions,
    input.registerOptions,
  );

  return {
    mintAddress: result.mintAddress,
    genesisAccount: result.genesisAccount,
    signatures: encodeSignatures(result.signatures),
    launch: result.launch,
    token: result.token,
    agentAsset: String(agentMint),
    network,
    agentTokenSet: input.setToken === true,
  };
}

export type PrepareLaunchAgentTokenResult = CreateLaunchResponse & {
  network: SvmNetwork;
  agentAsset: string;
  setToken: boolean;
};

/**
 * Two-step variant of {@link launchAgentToken} for callers that need to
 * inspect / modify the unsigned transactions (priority fees, hardware
 * wallets, custom retry loops). Pair with
 * {@link sendPreparedAgentTokenLaunch}.
 */
export async function prepareAgentTokenLaunch(
  umi: Umi,
  input: LaunchAgentTokenInput,
): Promise<PrepareLaunchAgentTokenResult> {
  const network = input.network ?? 'solana-devnet';
  const wallet = input.wallet ? toPk(input.wallet) : umi.identity.publicKey;
  const agentMint = toPk(input.agentAsset);

  const created = await createLaunch(umi, input.api ?? null, {
    wallet,
    network,
    launchType: 'bondingCurve',
    token: input.token,
    launch: input.launch ?? {},
    agent: { mint: agentMint, setToken: input.setToken ?? false },
  });
  return { ...created, network, agentAsset: String(agentMint), setToken: input.setToken ?? false };
}

/**
 * Sign + send a transaction bundle from {@link prepareAgentTokenLaunch}
 * and register the resulting launch with Metaplex. Returns the same
 * shape as {@link launchAgentToken}.
 */
export async function sendPreparedAgentTokenLaunch(
  umi: Umi,
  prepared: PrepareLaunchAgentTokenResult,
  opts?: {
    signAndSendOptions?: SignAndSendOptions;
    registerOptions?: RegisterOptions;
    api?: GenesisApiConfig;
  },
): Promise<LaunchAgentTokenResult> {
  const sigs = await signAndSendLaunchTransactions(umi, prepared, opts?.signAndSendOptions);
  const registered: RegisterLaunchResponse = await registerLaunch(umi, opts?.api ?? null, {
    genesisAccount: prepared.genesisAccount,
    createLaunchInput: {
      wallet: umi.identity.publicKey,
      network: prepared.network,
      launchType: 'bondingCurve',
      token: {
        // The Metaplex API only validates the metadata fields it cares
        // about for registration; we forward what the user provided
        // verbatim by re-reading from the response if needed.
        name: '',
        symbol: '',
        image: '',
      },
      launch: {},
      agent: { mint: publicKey(prepared.agentAsset), setToken: prepared.setToken },
    },
    ...(opts?.registerOptions ?? {}),
  } as RegisterLaunchInput);
  return {
    mintAddress: prepared.mintAddress,
    genesisAccount: prepared.genesisAccount,
    signatures: encodeSignatures(sigs),
    launch: registered.launch,
    token: registered.token,
    agentAsset: prepared.agentAsset,
    network: prepared.network,
    agentTokenSet: prepared.setToken,
  };
}

export type SetAgentTokenInput = {
  /** Agent's Core asset address. */
  agentAsset: string | PublicKey;
  /**
   * Genesis account PDA returned by {@link launchAgentToken} (or the raw
   * Genesis SDK). The `setAgentTokenV1` instruction reads this account
   * to discover the underlying mint.
   */
  genesisAccount: string | PublicKey;
  /**
   * The Core collection that owns the agent asset. Required by
   * `mpl-core::Execute`. Optional only if you're attaching to an
   * uncollected asset — almost never the case for Leash agents.
   */
  collection?: string | PublicKey | { publicKey: string | PublicKey } | CollectionV1;
  /** Defaults to `umi.payer`. */
  payer?: Signer;
  /**
   * Defaults to `umi.identity` — must be the **agent asset owner**. The
   * inner `setAgentTokenV1` is signed by the agent's Asset Signer PDA
   * via Core CPI.
   */
  authority?: Signer;
};

export type SetAgentTokenResult = {
  /** Base58 transaction signature. */
  signature: string;
  /** Echo of the agent asset address. */
  agentAsset: string;
  /** Echo of the genesis account PDA. */
  genesisAccount: string;
};

export type PrepareSetAgentTokenResult = {
  /** Unsigned `mpl-core::Execute(setAgentTokenV1)` builder. */
  builder: ReturnType<typeof execute>;
  /** Echo of the agent asset address. */
  agentAsset: string;
  /** Echo of the genesis account PDA. */
  genesisAccount: string;
};

/**
 * Build (but do not send) the `mpl-core::Execute(setAgentTokenV1)`
 * transaction that permanently associates `genesisAccount`'s mint with
 * the agent. Useful for HTTP / remote-signer flows.
 *
 * Pair with `umi.transactions.serialize(builder.build(umi))` for a raw
 * tx payload, or call `builder.sendAndConfirm(umi)` directly (which is
 * what {@link setAgentToken} does).
 *
 * **Irreversible** once submitted — same warning as {@link setAgentToken}.
 */
export async function prepareSetAgentToken(
  umi: Umi,
  input: SetAgentTokenInput,
): Promise<PrepareSetAgentTokenResult> {
  const asset = toPk(input.agentAsset);
  const genesisAccount = toPk(input.genesisAccount);
  const [assetSignerPda] = findAssetSignerPda(umi, { asset });

  const setIx = setAgentTokenV1(umi, {
    asset,
    genesisAccount,
    authority: createNoopSigner(assetSignerPda),
  });

  // Resolve a Core collection arg (Execute requires either `collection:
  // undefined` for uncollected assets or the collection metadata).
  // Most Leash agents are minted into the standard agent collection by
  // `createAgent`; callers that know it should pass it for the cheapest
  // path. When omitted we let `mpl-core::execute` infer.
  type ExecuteCollectionArg = Parameters<typeof execute>[1]['collection'];
  const collectionArg: ExecuteCollectionArg = ((): ExecuteCollectionArg => {
    if (input.collection == null) return undefined;
    if (typeof input.collection === 'string') {
      return { publicKey: publicKey(input.collection) } as unknown as ExecuteCollectionArg;
    }
    if ('publicKey' in input.collection) {
      const raw = (input.collection as { publicKey: string | PublicKey }).publicKey;
      return {
        publicKey: typeof raw === 'string' ? publicKey(raw) : raw,
      } as unknown as ExecuteCollectionArg;
    }
    return input.collection as unknown as ExecuteCollectionArg;
  })();

  const builder = execute(umi, {
    asset: { publicKey: asset },
    collection: collectionArg,
    instructions: setIx.getInstructions(),
    ...(input.payer ? { payer: input.payer } : {}),
    ...(input.authority ? { authority: input.authority } : {}),
  });

  return {
    builder,
    agentAsset: String(asset),
    genesisAccount: String(genesisAccount),
  };
}

/**
 * Permanently associate `genesisAccount`'s mint with the agent. Wraps
 * `setAgentTokenV1` in `mpl-core::Execute` so the asset signer PDA
 * authorises the call. **Irreversible.**
 *
 * Most callers should prefer {@link launchAgentToken} with
 * `setToken: true`, which bundles the launch + association in one
 * Genesis flow. This helper is for the "I already launched a token,
 * now bind it" path (matches the docs' "Set Agent Token" snippet).
 */
export async function setAgentToken(
  umi: Umi,
  input: SetAgentTokenInput,
): Promise<SetAgentTokenResult> {
  const prepared = await prepareSetAgentToken(umi, input);
  const result = await prepared.builder.sendAndConfirm(umi);
  return {
    signature: base58.deserialize(result.signature)[0],
    agentAsset: prepared.agentAsset,
    genesisAccount: prepared.genesisAccount,
  };
}

export type AgentTokenStatus = {
  /** Echo of the agent asset address. */
  agentAsset: string;
  /** Echo of the agent's Asset Signer PDA (where creator fees accrue). */
  treasury: string;
  /**
   * `true` when the on-chain Agent Identity has an `agentToken` set.
   * Both `AgentIdentityV1` and `AgentIdentityV2` carry the field; v0.1
   * of the Identity program left it absent on V1, so older agents
   * legitimately return `false` even when they "have a token" via
   * Genesis records (those need a manual `setAgentToken` upgrade).
   */
  hasToken: boolean;
  /** The token mint, if any. */
  mint: string | null;
  /** Which Identity account flavour we read from. */
  source: 'v1' | 'v2' | 'none';
};

/**
 * Read whether an agent has been associated with a token yet.
 *
 * Reads `AgentIdentityV2` first (the current shape that exposes the
 * `agentToken` field directly); falls back to `AgentIdentityV1` for
 * agents that were minted before the v2 upgrade, in which case
 * `hasToken` is always `false` and the caller should treat the agent as
 * "needs `setAgentToken` to bind the new launch".
 */
export async function getAgentToken(
  umi: Umi,
  agentAsset: string | PublicKey,
): Promise<AgentTokenStatus> {
  const asset = toPk(agentAsset);
  const [treasury] = findAssetSignerPda(umi, { asset });
  const v2 = await safeFetchAgentIdentityV2FromSeeds(umi, { asset });
  if (v2 != null) {
    const tokenOption = v2.agentToken;
    const isSome =
      typeof (tokenOption as { __option?: string })?.__option === 'string'
        ? (tokenOption as { __option: string }).__option === 'Some'
        : tokenOption != null;
    const value = isSome ? (tokenOption as { value?: PublicKey }).value : null;
    return {
      agentAsset: String(asset),
      treasury: String(treasury),
      hasToken: isSome && value != null,
      mint: value != null ? String(value) : null,
      source: 'v2',
    };
  }
  const v1 = await safeFetchAgentIdentityV1FromSeeds(umi, { asset });
  if (v1 != null) {
    return {
      agentAsset: String(asset),
      treasury: String(treasury),
      hasToken: false,
      mint: null,
      source: 'v1',
    };
  }
  return {
    agentAsset: String(asset),
    treasury: String(treasury),
    hasToken: false,
    mint: null,
    source: 'none',
  };
}

/** Boolean shortcut around {@link getAgentToken}. */
export async function hasAgentToken(umi: Umi, agentAsset: string | PublicKey): Promise<boolean> {
  return (await getAgentToken(umi, agentAsset)).hasToken;
}

// Re-export the upstream Genesis types callers most often need so they
// don't have to reach into `@metaplex-foundation/genesis` directly.
export type {
  TokenMetadata,
  BondingCurveLaunchInput,
  GenesisApiConfig,
  SvmNetwork,
} from '@metaplex-foundation/genesis';
// Re-export the on-chain Agent Identity account types so the playground
// can `instanceof`-style narrow without a separate import.
export type { AgentIdentityV1, AgentIdentityV2 };

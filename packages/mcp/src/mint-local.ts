/**
 * Client-side agent provisioning.
 *
 * The Leash protocol no longer holds keypairs or runs a faucet —
 * agent provisioning is fully client-side from `@leashmarket/mcp` /
 * `@leashmarket/cli` / `@leashmarket/sdk`. This module owns the three operations
 * the host runs in series:
 *
 *   1. Generate (or import) the executive keypair.
 *   2. Mint the MPL Core agent asset (`@leashmarket/registry-utils::createAgent`).
 *   3. Set unlimited USDC spend delegation from the agent's treasury
 *      PDA to the executive (`setSpendDelegation`) so the buyer-kit
 *      can spend treasury USDC without `no_delegate` failures.
 *   4. POST `/v1/agents/record` so the API has a row for receipts +
 *      discovery + reputation indexing.
 *
 * The executive must already hold enough SOL to pay rent + tx fees;
 * `quoteMintCostLamports` exposes the threshold so the host can
 * surface a `funding_required` UX before attempting the mint.
 *
 * Same logic on devnet + mainnet — the only network-specific bits
 * are the USDC mint address (resolved via `KNOWN_STABLES`) and the
 * cluster slug threaded into `createAgent`.
 */

import { mplCore, safeFetchAssetV1 } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey,
  type Keypair as UmiKeypair,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

import type { SvmNetwork } from '@leashmarket/mcp-core';
import {
  KNOWN_STABLES,
  SPL_TOKEN_PROGRAM_ID,
  buildRegistrationV1,
  createAgent,
  registrationToDataUrl,
  setSpendDelegation,
  type RegistrationService,
} from '@leashmarket/registry-utils';

/**
 * Recommended SOL balance for the executive before calling
 * `mintAgentLocally`. Sized for one Core mint + one Approve tx +
 * one ATA creation + a healthy buffer for priority fees and the
 * occasional retry. Same number for devnet and mainnet — rent is
 * the dominant cost on both.
 *
 * Actual breakdown (devnet 2026-04 measurements):
 *   - Core asset rent:               ~0.00161 SOL
 *   - AgentIdentityV1 plugin rent:   ~0.00177 SOL
 *   - USDC ATA creation rent:        ~0.00203 SOL
 *   - 2 transaction signatures:      ~0.00001 SOL
 *   - priority + buffer:             ~0.00458 SOL
 *   - total recommended:             ~0.01000 SOL
 */
export const RECOMMENDED_FUND_LAMPORTS = 10_000_000n;
export const RECOMMENDED_FUND_SOL = '0.01';
/** Hard lower bound — below this the mint cannot land at all. */
export const MIN_FUND_LAMPORTS = 4_500_000n;

const LAMPORTS_PER_SOL = 1_000_000_000;

export type ExecutiveKeypair = {
  /** 64-byte ed25519 secret, base58. */
  secretBase58: string;
  /** Base58 pubkey. */
  pubkey: string;
};

/** Generate a fresh executive keypair using Umi's eddsa primitives. */
export function generateExecutive(): ExecutiveKeypair {
  const probe = createUmi('https://invalid');
  const kp = probe.eddsa.generateKeypair();
  return {
    secretBase58: base58.deserialize(kp.secretKey)[0],
    pubkey: kp.publicKey.toString(),
  };
}

/**
 * Decode an imported executive secret and return its pubkey. Used to
 * validate `mode: "import"` input before persisting it.
 *
 * Accepts both base58 (the form the MCP / CLI emit) and the JSON-array
 * form `solana-keygen` writes. Throws on wrong-length / non-base58
 * input so the LLM-facing error is actionable.
 */
export function importExecutive(secretRaw: string): ExecutiveKeypair {
  const trimmed = secretRaw.trim();

  let bytes: Uint8Array;
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error('executive secret JSON must be a 64-element byte array');
    }
    bytes = Uint8Array.from(parsed.map((n) => Number(n)));
    if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
      throw new Error('executive secret JSON contains non-byte values');
    }
  } else {
    try {
      bytes = base58.serialize(trimmed);
    } catch (err) {
      throw new Error(
        `executive secret is not a valid base58 string: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    if (bytes.length !== 64) {
      throw new Error(
        `executive secret must decode to 64 bytes (got ${bytes.length}). Use solana-keygen output verbatim.`,
      );
    }
  }

  const probe = createUmi('https://invalid');
  const kp: UmiKeypair = probe.eddsa.createKeypairFromSecretKey(bytes);
  return {
    secretBase58: base58.deserialize(bytes)[0],
    pubkey: kp.publicKey.toString(),
  };
}

/**
 * Read the executive's current SOL balance via RPC. Single-shot
 * read, no retry — callers compose this with their own polling.
 */
export async function getExecutiveBalanceLamports(args: {
  rpcUrl: string;
  pubkey: string;
}): Promise<bigint> {
  const umi = createUmi(args.rpcUrl);
  const sol = await umi.rpc.getBalance(publicKey(args.pubkey));
  return BigInt(sol.basisPoints.toString());
}

export type MintLocallyArgs = {
  executive: ExecutiveKeypair;
  network: SvmNetwork;
  rpcUrl: string;
  apiBaseUrl: string;
  apiKey?: string | null;
  /** Friendly name written into MPL Core metadata. Defaults to `Agent <pub[0..8]>`. */
  name?: string;
  description?: string;
  imageUrl?: string;
  /**
   * EIP-8004 RegistrationV1 `services[]` — caller-controlled endpoints
   * the agent advertises (e.g. `{ name: 'web', endpoint: 'https://…' }`,
   * `{ name: 'api', endpoint: 'https://…' }`). Threaded through three
   * places in lockstep:
   *   1. On-chain MPL Core `agentMetadata.services[]` (via `createAgent`).
   *   2. Off-chain RegistrationV1 doc embedded in the asset `uri`
   *      (`buildRegistrationV1(...).services`).
   *   3. Platform DB row written by `POST /v1/agents/record`.
   * Leash always auto-injects a `receipts` service entry — callers
   * don't need to supply one.
   */
  services?: RegistrationService[];
  fetchImpl?: typeof globalThis.fetch;
};

export type MintLocallyResult = {
  mint: string;
  treasury: string;
  executivePubkey: string;
  network: SvmNetwork;
  txSignatures: {
    mint: string;
    delegate: string;
  };
  receiptsServiceUrl: string;
};

/**
 * Mint a brand-new agent owned by `executive`, set unlimited USDC
 * spend delegation from the asset's treasury to the executive, and
 * record the result on the Leash API.
 *
 * Fails if the executive lacks SOL — caller is responsible for
 * checking `getExecutiveBalanceLamports` against
 * `RECOMMENDED_FUND_LAMPORTS` first.
 */
export async function mintAgentLocally(args: MintLocallyArgs): Promise<MintLocallyResult> {
  const { executive, network, rpcUrl, apiBaseUrl } = args;
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const name = (args.name ?? '').trim() || `Agent ${executive.pubkey.slice(0, 8)}`;
  const description = args.description ?? 'Provisioned via @leashmarket/mcp';
  const imageUrl = args.imageUrl ?? '';
  const callerServices = args.services ?? [];

  const umi = buildExecutiveUmi(rpcUrl, executive);

  // Build the EIP-8004 RegistrationV1 doc once and reuse it for both
  // the on-chain `uri` and (after the mint lands) the platform DB
  // row. `createAgent` writes its own `receipts` service entry into
  // the on-chain `agentMetadata.services[]` block, so we keep the
  // off-chain doc symmetrical: caller services + receipts injection
  // happen via the same `@leashmarket/registry-utils` paths the chat
  // product uses.
  const registration = buildRegistrationV1({
    name,
    description,
    image: imageUrl,
    services: callerServices,
    x402Support: true,
  });
  const uri = registrationToDataUrl(registration);

  // 1. Mint the MPL Core agent. The executive pays rent, owns the
  //    asset, and controls the on-chain identity from this point on.
  //    `createAgent` from `@leashmarket/registry-utils` auto-injects a
  //    `receipts` service unless the caller already includes one.
  const minted = await createAgent(umi, {
    wallet: executive.pubkey,
    name,
    uri,
    description,
    network,
    services: callerServices,
  });

  // 2. Wait for the asset to be visible on RPC. Devnet routinely takes
  //    1-3s between confirmation and account-read indexing; mainnet is
  //    usually <1s but can spike. Polling avoids
  //    `mpl-core::Execute(SPL.Approve)` panicking with "Invalid Asset
  //    passed in" when the program reads an empty slot.
  await waitForAssetVisible({ umi, asset: minted.assetAddress });

  // 3. Set unlimited USDC delegation. Without this the buyer-kit's
  //    pre-flight returns `no_delegate` and the very first
  //    `leash_pay_payment_link` call fails. Cap is `u64::MAX`; users
  //    can revoke / re-approve smaller caps later via
  //    `@leashmarket/registry-utils::setSpendDelegation` /
  //    `revokeSpendDelegation`.
  const usdc = KNOWN_STABLES[network].find((s) => s.symbol === 'USDC');
  if (!usdc) {
    throw new Error(`USDC not configured for ${network}`);
  }
  const delegation = await setSpendDelegation(umi, {
    agentAsset: minted.assetAddress,
    mint: usdc.mint,
    executive: executive.pubkey,
    amount: 2n ** 64n - 1n,
    tokenProgram: usdc.tokenProgram ?? SPL_TOKEN_PROGRAM_ID,
  });

  // 4. Record the platform row. Server reads the asset over RPC,
  //    verifies `owner === executive_pubkey`, and writes the agents
  //    table + stub service key. Idempotent on `mint`.
  const recordUrl = `${apiBaseUrl.replace(/\/+$/, '')}/v1/agents/record`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (args.apiKey) headers.authorization = `Bearer ${args.apiKey}`;
  const recordRes = await fetchImpl(recordUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mint: minted.assetAddress,
      executive_pubkey: executive.pubkey,
      name,
      ...(description ? { description } : {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
      services: callerServices,
      network,
    }),
  });
  const recordText = await recordRes.text();
  if (!recordRes.ok) {
    throw new Error(`/v1/agents/record ${recordRes.status}: ${recordText.slice(0, 500)}`);
  }
  const recorded = JSON.parse(recordText) as {
    mint: string;
    treasury: string;
    receipts_service: string;
  };

  return {
    mint: recorded.mint,
    treasury: recorded.treasury,
    executivePubkey: executive.pubkey,
    network,
    txSignatures: {
      mint: minted.signature,
      delegate: delegation.signature,
    },
    receiptsServiceUrl: recorded.receipts_service,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

function buildExecutiveUmi(rpcUrl: string, executive: ExecutiveKeypair): Umi {
  const umi = createUmi(rpcUrl).use(mplCore()).use(mplToolbox());
  const secret = base58.serialize(executive.secretBase58);
  const kp = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(kp));
  return umi;
}

/**
 * Convert SOL display units (e.g. `0.01`) to lamports without the
 * float quirks of `Number * 1e9`. Used by callers that need to
 * format funding instructions for the model.
 */
export function solToLamports(sol: string): bigint {
  const n = Number(sol);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid SOL amount: ${sol}`);
  }
  return BigInt(Math.round(n * LAMPORTS_PER_SOL));
}

/**
 * Inverse of {@link solToLamports} — returns a fixed-9 string the
 * UI can show without scientific notation.
 */
export function lamportsToSol(lamports: bigint): string {
  if (lamports < 0n) {
    throw new Error(`invalid lamports: ${lamports}`);
  }
  const whole = lamports / BigInt(LAMPORTS_PER_SOL);
  const frac = (lamports % BigInt(LAMPORTS_PER_SOL)).toString().padStart(9, '0');
  return `${whole}.${frac}`.replace(/0+$/, '').replace(/\.$/, '.0');
}

async function waitForAssetVisible(args: {
  umi: Umi;
  asset: string;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = Date.now() + (args.timeoutMs ?? 20_000);
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const found = await safeFetchAssetV1(args.umi, publicKey(args.asset));
      if (found) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(
    `mint ${args.asset} not visible on RPC within ${(args.timeoutMs ?? 20_000) / 1000}s${
      lastErr ? `: ${lastErr instanceof Error ? lastErr.message : 'unknown'}` : ''
    }`,
  );
}

// `buildRegistrationDataUrl` was inlined here in v0.2 — it's now
// shared with the chat product via `@leashmarket/registry-utils`'s
// `buildRegistrationV1` + `registrationToDataUrl`. Keeping all
// three surfaces (chat / MCP / CLI) on one EIP-8004 builder means
// the on-chain `uri` shape stays identical regardless of who minted.

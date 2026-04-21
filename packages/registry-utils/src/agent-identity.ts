import {
  safeFetchAgentIdentityV1FromSeeds,
  type AgentIdentityV1,
} from '@metaplex-foundation/mpl-agent-registry';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import type { Context, PublicKey, Umi } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';
import { RegistrationV1Schema, type RegistrationV1 } from '@leash/schemas';
import { FetchError, InvalidSchemaError } from './errors.js';

export type AgentIdentityStatus =
  | { registered: true; account: AgentIdentityV1; treasury: string }
  | { registered: false; treasury: string };

/**
 * Looks up the on-chain Agent Identity PDA for a Core asset and derives the
 * Asset Signer PDA (the agent's built-in treasury wallet) at the same time.
 * Returns `registered: false` if the identity plugin was never attached
 * (i.e. the asset exists but is not a Leash agent).
 */
export async function getAgentIdentityStatus(
  umi: Umi,
  asset: string | PublicKey,
): Promise<AgentIdentityStatus> {
  const assetPk = typeof asset === 'string' ? publicKey(asset) : asset;
  const [treasury] = findAssetSignerPda(umi, { asset: assetPk });
  const account = await safeFetchAgentIdentityV1FromSeeds(umi, { asset: assetPk });
  if (account == null) {
    return { registered: false, treasury: String(treasury) };
  }
  return { registered: true, account, treasury: String(treasury) };
}

/**
 * Convenience wrapper around `findAssetSignerPda`. Mirrors the docs example
 * in "Read Agent Data → Fetch the Agent's Wallet".
 */
export function getAgentTreasury(
  context: Pick<Context, 'eddsa' | 'programs'>,
  asset: string | PublicKey,
): string {
  const assetPk = typeof asset === 'string' ? publicKey(asset) : asset;
  const [pda] = findAssetSignerPda(context, { asset: assetPk });
  return String(pda);
}

/**
 * Fetches and validates the off-chain registration document linked from an
 * agent's identity. Strict — throws on schema mismatch or fetch failure.
 */
export async function loadAgentRegistration(uri: string): Promise<RegistrationV1> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new FetchError(`Failed to load registration: ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FetchError('Registration URI did not return JSON');
  }
  const parsed = RegistrationV1Schema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidSchemaError(parsed.error.message);
  }
  return parsed.data;
}

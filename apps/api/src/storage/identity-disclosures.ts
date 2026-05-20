import { ulid } from 'ulid';
import type { IdentityDisclosureResource } from '@leashmarket/schemas';

import type { SvmNetwork } from '../util/network.js';
import type { DbClient } from './turso.js';
import { execute } from './turso.js';

export type { IdentityDisclosureResource } from '@leashmarket/schemas';

export type IdentityDisclosureGrant = {
  id: string;
  agentMint: string;
  network: SvmNetwork;
  tokenHash: string;
  resources: IdentityDisclosureResource[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

function parseResources(value: unknown): IdentityDisclosureResource[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? (parsed as IdentityDisclosureResource[]) : [];
  } catch {
    return [];
  }
}

function networkFromRow(value: unknown): SvmNetwork {
  const network = String(value);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`unexpected disclosure network: ${network}`);
  }
  return network;
}

function rowToGrant(row: Record<string, unknown>): IdentityDisclosureGrant {
  return {
    id: String(row.id),
    agentMint: String(row.agent_mint),
    network: networkFromRow(row.network),
    tokenHash: String(row.token_hash),
    resources: parseResources(row.resources_json),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    createdAt: String(row.created_at),
  };
}

export async function createIdentityDisclosure(
  db: DbClient,
  input: {
    agentMint: string;
    network: SvmNetwork;
    tokenHash: string;
    resources: IdentityDisclosureResource[];
    expiresAt: string;
  },
): Promise<IdentityDisclosureGrant> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO agent_identity_disclosures (
      id, agent_mint, network, token_hash, resources_json, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agentMint,
      input.network,
      input.tokenHash,
      JSON.stringify(input.resources),
      input.expiresAt,
    ],
  );
  const row = await getIdentityDisclosure(db, id);
  if (!row) throw new Error('identity disclosure insert succeeded but lookup failed');
  return row;
}

export async function getIdentityDisclosure(
  db: DbClient,
  id: string,
): Promise<IdentityDisclosureGrant | null> {
  const res = await execute(db, `SELECT * FROM agent_identity_disclosures WHERE id = ? LIMIT 1`, [
    id,
  ]);
  const row = res.rows[0];
  return row ? rowToGrant(row as Record<string, unknown>) : null;
}

export async function getIdentityDisclosureByTokenHash(
  db: DbClient,
  tokenHash: string,
): Promise<IdentityDisclosureGrant | null> {
  const res = await execute(
    db,
    `SELECT * FROM agent_identity_disclosures WHERE token_hash = ? LIMIT 1`,
    [tokenHash],
  );
  const row = res.rows[0];
  return row ? rowToGrant(row as Record<string, unknown>) : null;
}

export async function listIdentityDisclosures(
  db: DbClient,
  agentMint: string,
): Promise<IdentityDisclosureGrant[]> {
  const res = await execute(
    db,
    `SELECT * FROM agent_identity_disclosures
     WHERE agent_mint = ?
     ORDER BY created_at DESC`,
    [agentMint],
  );
  return res.rows.map((row) => rowToGrant(row as Record<string, unknown>));
}

export async function revokeIdentityDisclosure(db: DbClient, id: string): Promise<void> {
  await execute(
    db,
    `UPDATE agent_identity_disclosures
     SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE id = ?`,
    [id],
  );
}

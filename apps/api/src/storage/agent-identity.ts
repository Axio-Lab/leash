import { ulid } from 'ulid';

import type { SvmNetwork } from '../util/network.js';
import type { DbClient } from './turso.js';
import { execute } from './turso.js';

export type IdentityVisibility = 'public' | 'private';

export type IdentityCapabilityCard = {
  id: string;
  kind:
    | 'seller_api'
    | 'buyer_tool'
    | 'data_source'
    | 'control_channel'
    | 'automation'
    | 'marketplace'
    | 'pay_skills'
    | 'custom';
  title: string;
  description?: string;
  source?: 'leash' | 'pay-skills' | 'manual' | 'connection' | 'automation';
  slug?: string;
  endpoint?: string;
  tags: string[];
  protocols: Array<'x402' | 'mpp'>;
  visibility: IdentityVisibility;
};

export type AgentIdentityProfile = {
  agentMint: string;
  network: SvmNetwork;
  handle: string | null;
  visibility: Record<string, unknown>;
  capabilityCards: IdentityCapabilityCard[];
  createdAt: string;
  updatedAt: string;
};

export type AgentIdentityDomain = {
  domain: string;
  agentMint: string;
  network: SvmNetwork;
  status: 'pending' | 'verified' | 'failed';
  verifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentIdentityClaim = {
  id: string;
  agentMint: string;
  network: SvmNetwork;
  issuer: string;
  subjectMint: string;
  type: string;
  value: string;
  evidenceUrl: string | null;
  signature: string;
  visibility: IdentityVisibility;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseCapabilityCards(value: unknown): IdentityCapabilityCard[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? (parsed as IdentityCapabilityCard[]) : [];
  } catch {
    return [];
  }
}

function networkFromRow(value: unknown): SvmNetwork {
  const network = String(value);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`unexpected identity network: ${network}`);
  }
  return network;
}

function profileFromRow(row: Record<string, unknown>): AgentIdentityProfile {
  return {
    agentMint: String(row.agent_mint),
    network: networkFromRow(row.network),
    handle: row.handle == null ? null : String(row.handle),
    visibility: parseJsonObject(row.visibility),
    capabilityCards: parseCapabilityCards(row.capability_cards),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function domainFromRow(row: Record<string, unknown>): AgentIdentityDomain {
  const status = String(row.status);
  if (status !== 'pending' && status !== 'verified' && status !== 'failed') {
    throw new Error(`unexpected identity domain status: ${status}`);
  }
  return {
    domain: String(row.domain),
    agentMint: String(row.agent_mint),
    network: networkFromRow(row.network),
    status,
    verifiedAt: row.verified_at == null ? null : String(row.verified_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function claimFromRow(row: Record<string, unknown>): AgentIdentityClaim {
  const visibility = String(row.visibility);
  if (visibility !== 'public' && visibility !== 'private') {
    throw new Error(`unexpected identity claim visibility: ${visibility}`);
  }
  return {
    id: String(row.id),
    agentMint: String(row.agent_mint),
    network: networkFromRow(row.network),
    issuer: String(row.issuer),
    subjectMint: String(row.subject_mint),
    type: String(row.type),
    value: String(row.value),
    evidenceUrl: row.evidence_url == null ? null : String(row.evidence_url),
    signature: String(row.signature),
    visibility,
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    createdAt: String(row.created_at),
  };
}

export async function upsertAgentIdentityProfile(
  db: DbClient,
  input: {
    agentMint: string;
    network: SvmNetwork;
    handle?: string | null;
    capabilityCards?: IdentityCapabilityCard[];
    visibility?: Record<string, unknown>;
  },
): Promise<AgentIdentityProfile> {
  const existing = await getAgentIdentityProfile(db, input.agentMint);
  const handle = input.handle !== undefined ? input.handle : (existing?.handle ?? null);
  const visibility =
    input.visibility !== undefined ? input.visibility : (existing?.visibility ?? {});
  const capabilityCards =
    input.capabilityCards !== undefined ? input.capabilityCards : (existing?.capabilityCards ?? []);

  await execute(
    db,
    `INSERT INTO agent_identity_profiles (
      agent_mint, network, handle, visibility, capability_cards, updated_at
    ) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(agent_mint) DO UPDATE SET
      network = excluded.network,
      handle = excluded.handle,
      visibility = excluded.visibility,
      capability_cards = excluded.capability_cards,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [
      input.agentMint,
      input.network,
      handle,
      JSON.stringify(visibility),
      JSON.stringify(capabilityCards),
    ],
  );
  const row = await getAgentIdentityProfile(db, input.agentMint);
  if (!row) throw new Error('identity profile upsert succeeded but lookup failed');
  return row;
}

export async function getAgentIdentityProfile(
  db: DbClient,
  agentMint: string,
): Promise<AgentIdentityProfile | null> {
  const res = await execute(
    db,
    `SELECT * FROM agent_identity_profiles WHERE agent_mint = ? LIMIT 1`,
    [agentMint],
  );
  const row = res.rows[0];
  return row ? profileFromRow(row as Record<string, unknown>) : null;
}

export async function getAgentIdentityProfileByHandle(
  db: DbClient,
  handle: string,
): Promise<AgentIdentityProfile | null> {
  const res = await execute(db, `SELECT * FROM agent_identity_profiles WHERE handle = ? LIMIT 1`, [
    handle,
  ]);
  const row = res.rows[0];
  return row ? profileFromRow(row as Record<string, unknown>) : null;
}

export async function upsertAgentIdentityDomain(
  db: DbClient,
  input: {
    domain: string;
    agentMint: string;
    network: SvmNetwork;
    status: AgentIdentityDomain['status'];
    verifiedAt?: string | null;
    lastError?: string | null;
  },
): Promise<AgentIdentityDomain> {
  await execute(
    db,
    `INSERT INTO agent_identity_domains (
      domain, agent_mint, network, status, verified_at, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(domain) DO UPDATE SET
      agent_mint = excluded.agent_mint,
      network = excluded.network,
      status = excluded.status,
      verified_at = excluded.verified_at,
      last_error = excluded.last_error,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [
      input.domain,
      input.agentMint,
      input.network,
      input.status,
      input.verifiedAt ?? null,
      input.lastError ?? null,
    ],
  );
  const row = await getAgentIdentityDomain(db, input.domain);
  if (!row) throw new Error('identity domain upsert succeeded but lookup failed');
  return row;
}

export async function getAgentIdentityDomain(
  db: DbClient,
  domain: string,
): Promise<AgentIdentityDomain | null> {
  const res = await execute(db, `SELECT * FROM agent_identity_domains WHERE domain = ? LIMIT 1`, [
    domain,
  ]);
  const row = res.rows[0];
  return row ? domainFromRow(row as Record<string, unknown>) : null;
}

export async function listAgentIdentityDomains(
  db: DbClient,
  agentMint: string,
): Promise<AgentIdentityDomain[]> {
  const res = await execute(
    db,
    `SELECT * FROM agent_identity_domains WHERE agent_mint = ? ORDER BY created_at ASC`,
    [agentMint],
  );
  return res.rows.map((row) => domainFromRow(row as Record<string, unknown>));
}

export async function createAgentIdentityClaim(
  db: DbClient,
  input: Omit<AgentIdentityClaim, 'id' | 'createdAt' | 'revokedAt'> & { id?: string },
): Promise<AgentIdentityClaim> {
  const id = input.id ?? ulid();
  await execute(
    db,
    `INSERT INTO agent_identity_claims (
      id, agent_mint, network, issuer, subject_mint, type, value,
      evidence_url, signature, visibility, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agentMint,
      input.network,
      input.issuer,
      input.subjectMint,
      input.type,
      input.value,
      input.evidenceUrl,
      input.signature,
      input.visibility,
      input.expiresAt,
    ],
  );
  const row = await getAgentIdentityClaim(db, id);
  if (!row) throw new Error('identity claim insert succeeded but lookup failed');
  return row;
}

export async function getAgentIdentityClaim(
  db: DbClient,
  id: string,
): Promise<AgentIdentityClaim | null> {
  const res = await execute(db, `SELECT * FROM agent_identity_claims WHERE id = ? LIMIT 1`, [id]);
  const row = res.rows[0];
  return row ? claimFromRow(row as Record<string, unknown>) : null;
}

export async function listAgentIdentityClaims(
  db: DbClient,
  agentMint: string,
): Promise<AgentIdentityClaim[]> {
  const res = await execute(
    db,
    `SELECT * FROM agent_identity_claims WHERE agent_mint = ? ORDER BY created_at DESC`,
    [agentMint],
  );
  return res.rows.map((row) => claimFromRow(row as Record<string, unknown>));
}

export async function revokeAgentIdentityClaim(db: DbClient, id: string): Promise<void> {
  await execute(
    db,
    `UPDATE agent_identity_claims
     SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE id = ?`,
    [id],
  );
}

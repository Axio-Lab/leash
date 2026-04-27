/**
 * API key creation, hashing, and lookup. Keys are stored as
 * SHA-256(hex) — the raw value is shown to the user exactly once at
 * creation time and never persisted in plaintext.
 *
 * Format: `lsh_test_<24 random chars>` or `lsh_live_<24 random chars>`.
 * Prefix encodes the network (devnet vs mainnet); see `networkFromKey`
 * in `../config.ts`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { address } from '@solana/kit';
import { ulid } from 'ulid';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';
import { networkFromKey } from '../config.js';

const KEY_BODY_BYTES = 18; // base32 -> 28 chars; we trim to 24 for readability.

export type ApiKeyRecord = {
  id: string;
  label: string;
  network: SvmNetwork;
  prefix: string;
  last4: string;
  /** Solana wallet (base58 pubkey) this key was issued for; null if unset. */
  ownerWallet: string | null;
  createdAt: string;
  disabledAt: string | null;
};

export type CreateApiKeyResult = {
  key: ApiKeyRecord;
  /** Plaintext value — show ONCE to the user, then forget. */
  plaintext: string;
};

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function randomBody(): string {
  // base32-ish (Crockford-ish) for URL-friendliness without padding.
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(KEY_BODY_BYTES);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out.toLowerCase().slice(0, 24);
}

export function generateApiKey(network: SvmNetwork, plaintextOverride?: string): string {
  if (plaintextOverride) return plaintextOverride;
  const prefix = network === 'solana-devnet' ? 'lsh_test_' : 'lsh_live_';
  return `${prefix}${randomBody()}`;
}

/**
 * Validates and canonicalizes a Solana wallet address for `owner_wallet`.
 * Empty / whitespace-only input becomes `null`.
 */
export function normalizeOwnerWallet(input: string | null | undefined): string | null {
  if (input == null) return null;
  const t = input.trim();
  if (t.length === 0) return null;
  try {
    return String(address(t));
  } catch {
    throw new Error(`owner_wallet: invalid Solana address`);
  }
}

export async function createApiKey(
  db: DbClient,
  args: {
    label: string;
    network: SvmNetwork;
    plaintext?: string;
    ownerWallet: string | null;
  },
): Promise<CreateApiKeyResult> {
  const plaintext = generateApiKey(args.network, args.plaintext);
  const network = networkFromKey(plaintext);
  if (network !== args.network) {
    throw new Error(
      `key prefix mismatches requested network: ${plaintext.slice(0, 9)} vs ${args.network}`,
    );
  }
  const ownerWallet = normalizeOwnerWallet(args.ownerWallet);
  const id = ulid();
  const prefix = plaintext.slice(0, 9);
  const last4 = plaintext.slice(-4);
  const hash = hashKey(plaintext);
  await execute(
    db,
    `INSERT INTO api_keys (id, label, network, prefix, last4, hash, owner_wallet) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, args.label, network, prefix, last4, hash, ownerWallet],
  );
  const created = await getApiKeyById(db, id);
  if (!created) throw new Error('api key insert succeeded but lookup failed');
  return { key: created, plaintext };
}

export async function getApiKeyByPlaintext(
  db: DbClient,
  plaintext: string,
): Promise<ApiKeyRecord | null> {
  const hash = hashKey(plaintext);
  const res = await execute(
    db,
    `SELECT id, label, network, prefix, last4, owner_wallet, created_at, disabled_at
       FROM api_keys WHERE hash = ? LIMIT 1`,
    [hash],
  );
  const row = res.rows[0];
  if (!row) return null;
  return rowToRecord(row);
}

export async function getApiKeyById(db: DbClient, id: string): Promise<ApiKeyRecord | null> {
  const res = await execute(
    db,
    `SELECT id, label, network, prefix, last4, owner_wallet, created_at, disabled_at
       FROM api_keys WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return rowToRecord(row);
}

export async function disableApiKey(db: DbClient, id: string): Promise<void> {
  await execute(
    db,
    `UPDATE api_keys SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [id],
  );
}

export type ListApiKeysArgs = {
  network?: SvmNetwork;
  /** When set, only keys attributed to this wallet (canonical base58). */
  ownerWallet?: string;
  includeDisabled?: boolean;
  limit?: number;
};

export async function listApiKeys(
  db: DbClient,
  args: ListApiKeysArgs = {},
): Promise<ApiKeyRecord[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (args.network) {
    where.push('network = ?');
    params.push(args.network);
  }
  if (args.ownerWallet) {
    where.push('owner_wallet = ?');
    params.push(args.ownerWallet);
  }
  if (!args.includeDisabled) {
    where.push('disabled_at IS NULL');
  }
  const sql = `SELECT id, label, network, prefix, last4, owner_wallet, created_at, disabled_at
    FROM api_keys
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?`;
  params.push(args.limit ?? 100);
  const res = await execute(db, sql, params);
  return res.rows.map(rowToRecord);
}

function rowToRecord(row: Record<string, unknown>): ApiKeyRecord {
  const network = String(row.network);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`unexpected network in api_keys: ${network}`);
  }
  return {
    id: String(row.id),
    label: String(row.label),
    network,
    prefix: String(row.prefix),
    last4: String(row.last4),
    ownerWallet: row.owner_wallet != null ? String(row.owner_wallet) : null,
    createdAt: String(row.created_at),
    disabledAt: row.disabled_at != null ? String(row.disabled_at) : null,
  };
}

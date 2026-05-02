/**
 * `platform_api_keys` CRUD. The shape is a join: each row pairs a
 * Privy user with a Leash `api_keys.id`, plus a friendly name and the
 * scopes the user picked (`agents`, `marketplace`).
 *
 * Plaintext key values are returned exactly once at creation time by
 * `apps/api`'s admin endpoint — this table never stores them.
 */

import type { PlatformDbClient } from './users.js';

export type PlatformKeyRow = {
  privyId: string;
  keyId: string;
  name: string;
  scopes: string[];
  createdAt: string;
};

function rowToPlatformKey(row: Record<string, unknown>): PlatformKeyRow {
  let scopes: string[] = [];
  try {
    const parsed = JSON.parse(String(row.scopes ?? '[]'));
    if (Array.isArray(parsed)) scopes = parsed.map((s) => String(s));
  } catch {
    scopes = [];
  }
  return {
    privyId: String(row.privy_id),
    keyId: String(row.key_id),
    name: String(row.name),
    scopes,
    createdAt: String(row.created_at),
  };
}

export async function recordPlatformKey(
  db: PlatformDbClient,
  args: { privyId: string; keyId: string; name: string; scopes: string[] },
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO platform_api_keys (privy_id, key_id, name, scopes) VALUES (?, ?, ?, ?)`,
    args: [args.privyId, args.keyId, args.name, JSON.stringify(args.scopes)],
  });
}

export async function listPlatformKeys(
  db: PlatformDbClient,
  privyId: string,
): Promise<PlatformKeyRow[]> {
  const res = await db.execute({
    sql: `SELECT privy_id, key_id, name, scopes, created_at
            FROM platform_api_keys
           WHERE privy_id = ?
           ORDER BY created_at DESC`,
    args: [privyId],
  });
  return res.rows.map((r) => rowToPlatformKey(r as Record<string, unknown>));
}

export async function removePlatformKey(
  db: PlatformDbClient,
  args: { privyId: string; keyId: string },
): Promise<void> {
  await db.execute({
    sql: `DELETE FROM platform_api_keys WHERE privy_id = ? AND key_id = ?`,
    args: [args.privyId, args.keyId],
  });
}

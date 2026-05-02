/**
 * `platform_users` CRUD. The schema lives in `apps/api/src/storage/turso.ts`
 * (added in v6) — these helpers are usable from any service that has a
 * libsql `Client` (Next.js BFF route handlers, agent-runtime, etc.).
 */

import type { Client } from '@libsql/client';

export type PlatformDbClient = Client;

export type PlatformUser = {
  privyId: string;
  wallet: string;
  email: string | null;
  createdAt: string;
};

function rowToUser(row: Record<string, unknown>): PlatformUser {
  return {
    privyId: String(row.privy_id),
    wallet: String(row.wallet),
    email: row.email != null ? String(row.email) : null,
    createdAt: String(row.created_at),
  };
}

/**
 * Create a `platform_users` row if missing, otherwise update wallet
 * and email if they changed (a user can switch their primary wallet
 * in Privy). Returns the canonical row either way.
 */
export async function getOrCreateUser(
  db: PlatformDbClient,
  args: { privyId: string; wallet: string; email: string | null },
): Promise<PlatformUser> {
  const existing = await getUser(db, args.privyId);
  if (!existing) {
    await db.execute({
      sql: `INSERT INTO platform_users (privy_id, wallet, email) VALUES (?, ?, ?)`,
      args: [args.privyId, args.wallet, args.email],
    });
    const created = await getUser(db, args.privyId);
    if (!created) throw new Error('platform_users insert succeeded but lookup failed');
    return created;
  }
  if (existing.wallet !== args.wallet || existing.email !== args.email) {
    await db.execute({
      sql: `UPDATE platform_users SET wallet = ?, email = ? WHERE privy_id = ?`,
      args: [args.wallet, args.email, args.privyId],
    });
    return { ...existing, wallet: args.wallet, email: args.email };
  }
  return existing;
}

export async function getUser(db: PlatformDbClient, privyId: string): Promise<PlatformUser | null> {
  const res = await db.execute({
    sql: `SELECT privy_id, wallet, email, created_at FROM platform_users WHERE privy_id = ? LIMIT 1`,
    args: [privyId],
  });
  const row = res.rows[0];
  if (!row) return null;
  return rowToUser(row as Record<string, unknown>);
}

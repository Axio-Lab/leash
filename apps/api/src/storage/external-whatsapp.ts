/**
 * Storage helpers for the v14 `external_whatsapp_state` table.
 *
 * One row per `external_connections.id`. The Baileys
 * `AuthenticationState` ships in two pieces:
 *
 *   1. `creds`    — small JSON blob (a few KB), updated on every
 *                   `connection.update` and most `messages.upsert`.
 *   2. `keys`     — variable-size map keyed by `<type>-<id>` covering
 *                   pre-keys, sessions, sender keys, app-state-sync,
 *                   etc. Can grow into hundreds of KB after a few
 *                   weeks of activity but stays bounded since old
 *                   sessions roll off.
 *
 * Both blobs are serialised through Baileys' `BufferJSON.replacer` so
 * `Uint8Array` / `Buffer` survive the round-trip, then sealed with the
 * platform AES-GCM key (same envelope as `agents.encrypted_llm_key`).
 *
 * The schema also stashes the most recent QR string Baileys emitted
 * (plaintext, expires within ~60s) so the BFF can poll
 * `/v1/external/whatsapp/qr/{id}` while the user pairs.
 */

import { encryptSecret, decryptSecret } from '@leashmarket/platform-auth/encryption';

import type { DbClient } from './turso.js';

export type ExternalWhatsAppStateRow = {
  connectionId: string;
  encryptedCreds: string | null;
  encryptedKeys: string | null;
  lastQr: string | null;
  lastQrAt: string | null;
  meJid: string | null;
  createdAt: string;
  updatedAt: string;
};

function rowFromSql(r: Record<string, unknown>): ExternalWhatsAppStateRow {
  return {
    connectionId: String(r.connection_id),
    encryptedCreds: r.encrypted_creds == null ? null : String(r.encrypted_creds),
    encryptedKeys: r.encrypted_keys == null ? null : String(r.encrypted_keys),
    lastQr: r.last_qr == null ? null : String(r.last_qr),
    lastQrAt: r.last_qr_at == null ? null : String(r.last_qr_at),
    meJid: r.me_jid == null ? null : String(r.me_jid),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function getWhatsAppState(
  db: DbClient,
  connectionId: string,
): Promise<ExternalWhatsAppStateRow | null> {
  const res = await db.execute({
    sql: 'SELECT * FROM external_whatsapp_state WHERE connection_id = ?',
    args: [connectionId],
  });
  if (res.rows.length === 0) return null;
  return rowFromSql(res.rows[0] as unknown as Record<string, unknown>);
}

/**
 * Initialise (idempotent) an empty WhatsApp state row. Called once at
 * connection creation so subsequent saves can rely on the row existing.
 */
export async function ensureWhatsAppStateRow(db: DbClient, connectionId: string): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO external_whatsapp_state (connection_id) VALUES (?)`,
    args: [connectionId],
  });
}

export async function saveWhatsAppCreds(
  db: DbClient,
  args: { connectionId: string; credsJson: string; encryptionKey: string; meJid?: string | null },
): Promise<void> {
  const encrypted = encryptSecret(args.credsJson, args.encryptionKey);
  await db.execute({
    sql: `UPDATE external_whatsapp_state
            SET encrypted_creds = ?,
                me_jid = COALESCE(?, me_jid),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE connection_id = ?`,
    args: [encrypted, args.meJid ?? null, args.connectionId],
  });
}

export async function saveWhatsAppKeys(
  db: DbClient,
  args: { connectionId: string; keysJson: string; encryptionKey: string },
): Promise<void> {
  const encrypted = encryptSecret(args.keysJson, args.encryptionKey);
  await db.execute({
    sql: `UPDATE external_whatsapp_state
            SET encrypted_keys = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE connection_id = ?`,
    args: [encrypted, args.connectionId],
  });
}

export function loadWhatsAppCreds(
  row: ExternalWhatsAppStateRow,
  encryptionKey: string,
): string | null {
  if (!row.encryptedCreds) return null;
  return decryptSecret(row.encryptedCreds, encryptionKey);
}

export function loadWhatsAppKeys(
  row: ExternalWhatsAppStateRow,
  encryptionKey: string,
): string | null {
  if (!row.encryptedKeys) return null;
  return decryptSecret(row.encryptedKeys, encryptionKey);
}

/**
 * Replace the most recent QR pairing payload. Pass `null` to clear it
 * after a successful pair (the UI then knows to stop polling).
 */
export async function saveWhatsAppQr(
  db: DbClient,
  args: { connectionId: string; qr: string | null },
): Promise<void> {
  await db.execute({
    sql: `UPDATE external_whatsapp_state
            SET last_qr = ?,
                last_qr_at = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE connection_id = ?`,
    args: [args.qr, args.qr == null ? null : new Date().toISOString(), args.connectionId],
  });
}

/**
 * Wipe the row entirely. Called on revoke so a future `Add WhatsApp`
 * with the same id (won't happen — id is a ulid — but defensive)
 * doesn't reuse stale auth state.
 */
export async function deleteWhatsAppState(db: DbClient, connectionId: string): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM external_whatsapp_state WHERE connection_id = ?',
    args: [connectionId],
  });
}

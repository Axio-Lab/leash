/**
 * Storage helpers for the v13 `external_connections` / `external_messages`
 * / `external_approvals` triple — the Telegram + WhatsApp bridge backend.
 *
 * Mirrors the existing `platform-agents` / `platform-tasks` modules: typed
 * CRUD over libsql, no business logic, no auth. Encrypting `bot_token`
 * before it lands in `encrypted_credential` is the caller's job (uses the
 * same `@leash/platform-auth` AES-GCM envelope as `agents.encrypted_llm_key`).
 *
 * The `signing_mode` decision tree is enforced by the route handlers, not
 * the storage layer: this module accepts whatever shape the routes pass.
 */

import { createHash, randomBytes } from 'node:crypto';
import { ulid } from 'ulid';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';

export type ExternalChannel = 'telegram' | 'whatsapp';
export type ExternalStatus = 'pending' | 'connected' | 'error' | 'revoked';
export type ExternalSigningMode = 'deep_link' | 'delegated';
export type ExternalMessageDirection =
  | 'inbound'
  | 'outbound'
  | 'tool_call'
  | 'tool_result'
  | 'approval';

export type ExternalConnectionRow = {
  id: string;
  ownerPrivyId: string;
  channel: ExternalChannel;
  status: ExternalStatus;
  displayName: string | null;
  encryptedCredential: string | null;
  routingId: string | null;
  botUsername: string | null;
  verificationToken: string | null;
  boundChatId: string | null;
  allowlist: string[];
  signingMode: ExternalSigningMode;
  capPerTx: string | null;
  capPerDay: string | null;
  dailySpent: string;
  dailyWindowStart: string | null;
  encryptedDelegatedKey: string | null;
  delegatedPubkey: string | null;
  lastSeenAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

function rowToConnection(row: Record<string, unknown>): ExternalConnectionRow {
  const channel = String(row.channel);
  if (channel !== 'telegram' && channel !== 'whatsapp') {
    throw new Error(`unexpected channel: ${channel}`);
  }
  const status = String(row.status);
  if (
    status !== 'pending' &&
    status !== 'connected' &&
    status !== 'error' &&
    status !== 'revoked'
  ) {
    throw new Error(`unexpected status: ${status}`);
  }
  const signingMode = String(row.signing_mode);
  if (signingMode !== 'deep_link' && signingMode !== 'delegated') {
    throw new Error(`unexpected signing_mode: ${signingMode}`);
  }
  let allowlist: string[] = [];
  try {
    const parsed = JSON.parse(String(row.allowlist_json ?? '[]'));
    if (Array.isArray(parsed)) allowlist = parsed.map((v) => String(v));
  } catch {
    allowlist = [];
  }
  return {
    id: String(row.id),
    ownerPrivyId: String(row.owner_privy_id),
    channel,
    status,
    displayName: row.display_name == null ? null : String(row.display_name),
    encryptedCredential: row.encrypted_credential == null ? null : String(row.encrypted_credential),
    routingId: row.routing_id == null ? null : String(row.routing_id),
    botUsername: row.bot_username == null ? null : String(row.bot_username),
    verificationToken: row.verification_token == null ? null : String(row.verification_token),
    boundChatId: row.bound_chat_id == null ? null : String(row.bound_chat_id),
    allowlist,
    signingMode,
    capPerTx: row.cap_per_tx == null ? null : String(row.cap_per_tx),
    capPerDay: row.cap_per_day == null ? null : String(row.cap_per_day),
    dailySpent: String(row.daily_spent ?? '0'),
    dailyWindowStart: row.daily_window_start == null ? null : String(row.daily_window_start),
    encryptedDelegatedKey:
      row.encrypted_delegated_key == null ? null : String(row.encrypted_delegated_key),
    delegatedPubkey: row.delegated_pubkey == null ? null : String(row.delegated_pubkey),
    lastSeenAt: row.last_seen_at == null ? null : String(row.last_seen_at),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Compute the routing identifier for an inbound webhook URL. We hash the
 * BYO bot token rather than embedding it in the path so the Telegram-side
 * webhook config doesn't leak the token through any HTTP middleware logs
 * or browser dev-tools that might inspect the URL. SHA-256 hex (64 chars)
 * is overkill but matches the rest of the codebase's hash conventions.
 */
export function routingIdForBotToken(botToken: string): string {
  return createHash('sha256').update(botToken).digest('hex');
}

export type CreateExternalConnectionInput = {
  ownerPrivyId: string;
  channel: ExternalChannel;
  displayName?: string | null;
  encryptedCredential?: string | null;
  routingId?: string | null;
  botUsername?: string | null;
  verificationToken?: string | null;
  signingMode?: ExternalSigningMode;
  capPerTx?: string | null;
  capPerDay?: string | null;
};

export async function createExternalConnection(
  db: DbClient,
  input: CreateExternalConnectionInput,
): Promise<ExternalConnectionRow> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO external_connections (
      id, owner_privy_id, channel, status, display_name,
      encrypted_credential, routing_id, bot_username, verification_token,
      signing_mode, cap_per_tx, cap_per_day
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ownerPrivyId,
      input.channel,
      input.displayName ?? null,
      input.encryptedCredential ?? null,
      input.routingId ?? null,
      input.botUsername ?? null,
      input.verificationToken ?? null,
      input.signingMode ?? 'deep_link',
      input.capPerTx ?? null,
      input.capPerDay ?? null,
    ],
  );
  const created = await getExternalConnection(db, id);
  if (!created) throw new Error('external_connections insert succeeded but lookup failed');
  return created;
}

export async function getExternalConnection(
  db: DbClient,
  id: string,
): Promise<ExternalConnectionRow | null> {
  const res = await execute(db, `SELECT * FROM external_connections WHERE id = ? LIMIT 1`, [id]);
  const row = res.rows[0];
  return row ? rowToConnection(row as Record<string, unknown>) : null;
}

export async function listExternalConnectionsForOwner(
  db: DbClient,
  ownerPrivyId: string,
): Promise<ExternalConnectionRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM external_connections
       WHERE owner_privy_id = ?
       ORDER BY created_at DESC`,
    [ownerPrivyId],
  );
  return res.rows.map((r) => rowToConnection(r as Record<string, unknown>));
}

/**
 * Look up a connection by `(channel, routing_id)` skipping revoked rows.
 * The Telegram webhook handler calls this on every inbound update to
 * find out which user the message belongs to.
 */
export async function getConnectionByRoutingId(
  db: DbClient,
  channel: ExternalChannel,
  routingId: string,
): Promise<ExternalConnectionRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM external_connections
       WHERE channel = ? AND routing_id = ? AND status != 'revoked'
       LIMIT 1`,
    [channel, routingId],
  );
  const row = res.rows[0];
  return row ? rowToConnection(row as Record<string, unknown>) : null;
}

export async function getConnectionByVerificationToken(
  db: DbClient,
  verificationToken: string,
): Promise<ExternalConnectionRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM external_connections WHERE verification_token = ? LIMIT 1`,
    [verificationToken],
  );
  const row = res.rows[0];
  return row ? rowToConnection(row as Record<string, unknown>) : null;
}

/**
 * Atomically bind a `from.id` (Telegram chat-id, or WhatsApp JID) to a
 * pending connection and flip status to `connected`. The
 * `verification_token` is consumed (`SET ... = NULL`) so a leaked
 * `/start <token>` link can't be replayed against a different chat-id.
 * Returns true if the row was actually updated (so the route can decide
 * whether to send a "welcome" reply).
 */
export async function bindExternalConnection(
  db: DbClient,
  args: { id: string; boundChatId: string },
): Promise<boolean> {
  const res = await execute(
    db,
    `UPDATE external_connections
        SET bound_chat_id = ?,
            verification_token = NULL,
            status = 'connected',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND status = 'pending'`,
    [args.boundChatId, args.id],
  );
  return (res.rowsAffected ?? 0) > 0;
}

export async function refreshVerificationToken(
  db: DbClient,
  args: { id: string; verificationToken: string },
): Promise<void> {
  await execute(
    db,
    `UPDATE external_connections
        SET verification_token = ?,
            status = 'pending',
            bound_chat_id = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    [args.verificationToken, args.id],
  );
}

export type SigningPatch = {
  signingMode: ExternalSigningMode;
  capPerTx?: string | null;
  capPerDay?: string | null;
  encryptedDelegatedKey?: string | null;
  delegatedPubkey?: string | null;
};

export async function updateConnectionSigning(
  db: DbClient,
  id: string,
  patch: SigningPatch,
): Promise<void> {
  await execute(
    db,
    `UPDATE external_connections
        SET signing_mode = ?,
            cap_per_tx = ?,
            cap_per_day = ?,
            encrypted_delegated_key = ?,
            delegated_pubkey = ?,
            daily_spent = '0',
            daily_window_start = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    [
      patch.signingMode,
      patch.capPerTx ?? null,
      patch.capPerDay ?? null,
      patch.encryptedDelegatedKey ?? null,
      patch.delegatedPubkey ?? null,
      id,
    ],
  );
}

export async function updateConnectionAllowlist(
  db: DbClient,
  id: string,
  allowlist: string[],
): Promise<void> {
  await execute(
    db,
    `UPDATE external_connections
        SET allowlist_json = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    [JSON.stringify(allowlist), id],
  );
}

export async function touchConnectionLastSeen(db: DbClient, id: string): Promise<void> {
  await execute(
    db,
    `UPDATE external_connections
        SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    [id],
  );
}

export async function setConnectionError(
  db: DbClient,
  id: string,
  errorMessage: string | null,
): Promise<void> {
  await execute(
    db,
    `UPDATE external_connections
        SET error = ?,
            status = CASE WHEN ? IS NULL THEN status ELSE 'error' END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    [errorMessage, errorMessage, id],
  );
}

/**
 * Soft-revoke: clear secrets, set status to `revoked`. We do NOT delete
 * the row — keeping it lets the user see the historical connection in
 * audit views, and the unique routing index correctly excludes revoked
 * rows so the same bot token can be re-added later.
 */
export async function revokeExternalConnection(db: DbClient, id: string): Promise<void> {
  await execute(
    db,
    `UPDATE external_connections
        SET status = 'revoked',
            encrypted_credential = NULL,
            encrypted_delegated_key = NULL,
            delegated_pubkey = NULL,
            verification_token = NULL,
            bound_chat_id = NULL,
            cap_per_tx = NULL,
            cap_per_day = NULL,
            daily_spent = '0',
            daily_window_start = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    [id],
  );
}

// ── messages (audit ledger) ──────────────────────────────────────────

export type RecordExternalMessageInput = {
  connectionId: string;
  direction: ExternalMessageDirection;
  bodyHash?: string | null;
  payload?: Record<string, unknown>;
};

export async function recordExternalMessage(
  db: DbClient,
  input: RecordExternalMessageInput,
): Promise<void> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO external_messages (id, connection_id, direction, body_hash, payload)
       VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      input.connectionId,
      input.direction,
      input.bodyHash ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

// ── approvals ────────────────────────────────────────────────────────

export type ExternalApprovalRow = {
  token: string;
  connectionId: string;
  ownerPrivyId: string;
  agentMint: string;
  toolName: string;
  payload: Record<string, unknown>;
  expiresAt: string;
  consumedAt: string | null;
  resultReceiptHash: string | null;
  resultTxSig: string | null;
  resultError: string | null;
  createdAt: string;
};

function rowToApproval(row: Record<string, unknown>): ExternalApprovalRow {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.payload ?? '{}'));
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    token: String(row.token),
    connectionId: String(row.connection_id),
    ownerPrivyId: String(row.owner_privy_id),
    agentMint: String(row.agent_mint),
    toolName: String(row.tool_name),
    payload,
    expiresAt: String(row.expires_at),
    consumedAt: row.consumed_at == null ? null : String(row.consumed_at),
    resultReceiptHash: row.result_receipt_hash == null ? null : String(row.result_receipt_hash),
    resultTxSig: row.result_tx_sig == null ? null : String(row.result_tx_sig),
    resultError: row.result_error == null ? null : String(row.result_error),
    createdAt: String(row.created_at),
  };
}

/** Default approval lifetime: 5 minutes. */
export const APPROVAL_TTL_MS = 5 * 60 * 1000;

/**
 * URL-safe base64 (no padding) random token. 32 bytes → ~43 chars, far
 * past any practical brute-force, while staying short enough to render
 * cleanly inside Telegram MarkdownV2 inline links.
 */
export function newApprovalToken(): string {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export type CreateApprovalInput = {
  connectionId: string;
  ownerPrivyId: string;
  agentMint: string;
  toolName: string;
  payload: Record<string, unknown>;
  ttlMs?: number;
};

export async function createApproval(
  db: DbClient,
  input: CreateApprovalInput,
): Promise<ExternalApprovalRow> {
  const token = newApprovalToken();
  const ttl = input.ttlMs ?? APPROVAL_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  await execute(
    db,
    `INSERT INTO external_approvals (
       token, connection_id, owner_privy_id, agent_mint, tool_name, payload, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      token,
      input.connectionId,
      input.ownerPrivyId,
      input.agentMint,
      input.toolName,
      JSON.stringify(input.payload),
      expiresAt,
    ],
  );
  const created = await getApproval(db, token);
  if (!created) throw new Error('external_approvals insert succeeded but lookup failed');
  return created;
}

export async function getApproval(
  db: DbClient,
  token: string,
): Promise<ExternalApprovalRow | null> {
  const res = await execute(db, `SELECT * FROM external_approvals WHERE token = ? LIMIT 1`, [
    token,
  ]);
  const row = res.rows[0];
  return row ? rowToApproval(row as Record<string, unknown>) : null;
}

export type ConsumeApprovalInput = {
  token: string;
  result:
    | { kind: 'ok'; receiptHash?: string | null; txSig?: string | null }
    | { kind: 'error'; message: string };
};

/**
 * Mark an approval consumed. Returns true if the row was newly consumed,
 * false if it was already consumed (idempotent / replay-safe). Expired
 * tokens are also rejected here (`consumed_at IS NULL AND expires_at >
 * now()`), so the caller can treat false as "stop, do not re-execute".
 */
export async function consumeApproval(db: DbClient, input: ConsumeApprovalInput): Promise<boolean> {
  const isOk = input.result.kind === 'ok';
  const receipt = isOk
    ? ((input.result as { receiptHash?: string | null }).receiptHash ?? null)
    : null;
  const txSig = isOk ? ((input.result as { txSig?: string | null }).txSig ?? null) : null;
  const errorMessage = isOk ? null : (input.result as { message: string }).message;
  const res = await execute(
    db,
    `UPDATE external_approvals
        SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            result_receipt_hash = ?,
            result_tx_sig = ?,
            result_error = ?
      WHERE token = ?
        AND consumed_at IS NULL
        AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [receipt, txSig, errorMessage, input.token],
  );
  return (res.rowsAffected ?? 0) > 0;
}

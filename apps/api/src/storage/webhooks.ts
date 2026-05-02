/**
 * Outbound webhook subscriptions and per-event delivery state.
 *
 * Tables:
 *   - `webhooks`             — one row per (api_key_id, url) subscription.
 *   - `webhook_deliveries`   — one row per (webhook_id, event_id) attempt
 *                              with retry/backoff metadata.
 *
 * Events are matched to subscriptions by `(network, kind)`. A webhook
 * with an empty `events` array subscribes to *all* event kinds for its
 * network. The delivery worker reads `webhook_deliveries` ordered by
 * `next_attempt_at` and POSTs the payload, HMAC-signed with the
 * subscription's `secret`.
 *
 * Network is bound to the API key — devnet keys cannot subscribe to
 * mainnet events, by design.
 */

import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';
import type { EventKind, EventRow } from './events.js';

export type WebhookRow = {
  id: string;
  /**
   * Owner key. Mutually exclusive: a row is either keyed to an API
   * key (legacy / web product) or to an agent_mint (standalone MCP /
   * CLI authenticated via X-Leash-Sig).
   */
  apiKeyId: string | null;
  agentMint: string | null;
  network: SvmNetwork;
  url: string;
  secret: string;
  events: EventKind[];
  disabledAt: string | null;
  createdAt: string;
};

export type CreateWebhookInput = {
  apiKeyId: string;
  network: SvmNetwork;
  url: string;
  events?: EventKind[];
};

export type CreateAgentWebhookInput = {
  agentMint: string;
  network: SvmNetwork;
  url: string;
  events?: EventKind[];
};

function generateSecret(): string {
  // 32 bytes of entropy → 64 hex chars; plenty for HMAC-SHA256.
  return `whsec_${randomBytes(32).toString('hex')}`;
}

export async function createWebhook(db: DbClient, input: CreateWebhookInput): Promise<WebhookRow> {
  const id = ulid();
  const secret = generateSecret();
  const eventsJson = JSON.stringify(input.events ?? []);
  await execute(
    db,
    `INSERT INTO webhooks (id, api_key_id, agent_mint, network, url, secret, events_json)
       VALUES (?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(api_key_id, url) DO UPDATE SET
         events_json = excluded.events_json,
         disabled_at = NULL`,
    [id, input.apiKeyId, input.network, input.url, secret, eventsJson],
  );
  // Re-read to get the canonical row (ON CONFLICT may have kept an
  // older id + secret).
  const row = await getWebhookByUrl(db, input.apiKeyId, input.url);
  if (!row) throw new Error('webhook insert succeeded but lookup failed');
  return row;
}

/**
 * Agent-keyed companion to `createWebhook`. Used by the standalone
 * MCP / CLI flow where the caller authenticates with an X-Leash-Sig
 * header derived from their executive keypair instead of an API key.
 *
 * `(agent_mint, url)` is UNIQUE so re-issuing is a no-op upsert that
 * preserves the original `id` + `secret` (matching the legacy
 * `(api_key_id, url)` semantics).
 */
export async function createAgentWebhook(
  db: DbClient,
  input: CreateAgentWebhookInput,
): Promise<WebhookRow> {
  const id = ulid();
  const secret = generateSecret();
  const eventsJson = JSON.stringify(input.events ?? []);
  await execute(
    db,
    `INSERT INTO webhooks (id, api_key_id, agent_mint, network, url, secret, events_json)
       VALUES (?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_mint, url) DO UPDATE SET
         events_json = excluded.events_json,
         disabled_at = NULL`,
    [id, input.agentMint, input.network, input.url, secret, eventsJson],
  );
  const row = await getAgentWebhookByUrl(db, input.agentMint, input.url);
  if (!row) throw new Error('agent webhook insert succeeded but lookup failed');
  return row;
}

export async function listAgentWebhooks(db: DbClient, agentMint: string): Promise<WebhookRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM webhooks WHERE agent_mint = ? ORDER BY created_at DESC`,
    [agentMint],
  );
  return res.rows.map(rowToWebhook);
}

export async function getAgentWebhookByUrl(
  db: DbClient,
  agentMint: string,
  url: string,
): Promise<WebhookRow | null> {
  const res = await execute(db, `SELECT * FROM webhooks WHERE agent_mint = ? AND url = ? LIMIT 1`, [
    agentMint,
    url,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  return rowToWebhook(row);
}

export async function listWebhooks(db: DbClient, apiKeyId: string): Promise<WebhookRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM webhooks WHERE api_key_id = ? ORDER BY created_at DESC`,
    [apiKeyId],
  );
  return res.rows.map(rowToWebhook);
}

export async function getWebhookById(db: DbClient, id: string): Promise<WebhookRow | null> {
  const res = await execute(db, `SELECT * FROM webhooks WHERE id = ? LIMIT 1`, [id]);
  const row = res.rows[0];
  if (!row) return null;
  return rowToWebhook(row);
}

export async function getWebhookByUrl(
  db: DbClient,
  apiKeyId: string,
  url: string,
): Promise<WebhookRow | null> {
  const res = await execute(db, `SELECT * FROM webhooks WHERE api_key_id = ? AND url = ? LIMIT 1`, [
    apiKeyId,
    url,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  return rowToWebhook(row);
}

/**
 * Find every active subscription that should receive an event. The
 * legacy api-key rows match on `network` only; the new agent-keyed
 * rows additionally require `agent_mint == event.agent_asset` so an
 * agent only sees its own activity. Wildcard subs (empty events
 * array) match every kind on their network.
 */
export async function listMatchingWebhooksScoped(
  db: DbClient,
  args: { network: SvmNetwork; kind: EventKind; agentAsset: string | null },
): Promise<WebhookRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM webhooks
       WHERE network = ? AND disabled_at IS NULL
         AND (
           api_key_id IS NOT NULL
           OR (agent_mint IS NOT NULL AND agent_mint = ?)
         )`,
    [args.network, args.agentAsset ?? '__no_agent__'],
  );
  return res.rows
    .map(rowToWebhook)
    .filter((w) => w.events.length === 0 || w.events.includes(args.kind));
}

export async function disableWebhook(db: DbClient, id: string): Promise<void> {
  await execute(
    db,
    `UPDATE webhooks SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [id],
  );
}

export async function deleteWebhook(db: DbClient, id: string): Promise<void> {
  await execute(db, `DELETE FROM webhook_deliveries WHERE webhook_id = ?`, [id]);
  await execute(db, `DELETE FROM webhooks WHERE id = ?`, [id]);
}

/**
 * Find every active subscription on `network` that should fire for
 * `kind`. A subscription with an empty `events_json` array is a
 * wildcard.
 */
export async function listMatchingWebhooks(
  db: DbClient,
  network: SvmNetwork,
  kind: EventKind,
): Promise<WebhookRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM webhooks WHERE network = ? AND disabled_at IS NULL`,
    [network],
  );
  return res.rows.map(rowToWebhook).filter((w) => w.events.length === 0 || w.events.includes(kind));
}

export type DeliveryRow = {
  id: string;
  webhookId: string;
  eventId: string;
  payloadJson: string;
  attempts: number;
  delivered: boolean;
  nextAttemptAt: string;
  lastStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
};

/**
 * Fan an event row out to one delivery row per matching subscription.
 * Idempotent on `(webhook_id, event_id)` — safe to call multiple
 * times (e.g. when an event transitions through several phases).
 */
export async function enqueueDeliveriesForEvent(
  db: DbClient,
  event: EventRow,
): Promise<{ created: number }> {
  const subs = await listMatchingWebhooksScoped(db, {
    network: event.network,
    kind: event.kind,
    agentAsset: event.agentAsset,
  });
  if (subs.length === 0) return { created: 0 };
  const payload = buildEventPayload(event);
  const payloadJson = JSON.stringify(payload);
  let created = 0;
  for (const sub of subs) {
    const id = ulid();
    const res = await execute(
      db,
      `INSERT INTO webhook_deliveries (id, webhook_id, event_id, payload_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(webhook_id, event_id) DO NOTHING`,
      [id, sub.id, event.id, payloadJson],
    );
    if (res.rowsAffected > 0) created += 1;
  }
  return { created };
}

export async function listDuePending(db: DbClient, limit: number): Promise<DeliveryRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM webhook_deliveries
       WHERE delivered = 0 AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
       ORDER BY next_attempt_at ASC
       LIMIT ?`,
    [limit],
  );
  return res.rows.map(rowToDelivery);
}

export async function listRecentDeliveries(
  db: DbClient,
  webhookId: string,
  limit = 50,
): Promise<DeliveryRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM webhook_deliveries
       WHERE webhook_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    [webhookId, Math.min(Math.max(limit, 1), 200)],
  );
  return res.rows.map(rowToDelivery);
}

export async function markDelivered(db: DbClient, id: string, status: number): Promise<void> {
  await execute(
    db,
    `UPDATE webhook_deliveries
       SET delivered = 1, attempts = attempts + 1, last_status = ?,
           last_error = NULL, last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    [status, id],
  );
}

export async function markDeliveryFailed(
  db: DbClient,
  id: string,
  status: number | null,
  error: string,
  nextAttemptAt: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE webhook_deliveries
       SET attempts = attempts + 1, last_status = ?, last_error = ?,
           last_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), next_attempt_at = ?
       WHERE id = ?`,
    [status, error, nextAttemptAt, id],
  );
}

export type EventWebhookPayload = {
  type: 'event';
  event: {
    id: string;
    ts: string;
    kind: EventKind;
    phase: EventRow['phase'];
    network: SvmNetwork;
    client_reference: string | null;
    agent_asset: string | null;
    signature: string | null;
    mint: string | null;
    amount_atomic: string | null;
    metadata: Record<string, unknown>;
    error_code: string | null;
    error_message: string | null;
  };
};

export function buildEventPayload(event: EventRow): EventWebhookPayload {
  return {
    type: 'event',
    event: {
      id: event.id,
      ts: event.ts,
      kind: event.kind,
      phase: event.phase,
      network: event.network,
      client_reference: event.clientReference,
      agent_asset: event.agentAsset,
      signature: event.signature,
      mint: event.mint,
      amount_atomic: event.amountAtomic,
      metadata: event.metadata,
      error_code: event.errorCode,
      error_message: event.errorMessage,
    },
  };
}

function rowToWebhook(row: Record<string, unknown>): WebhookRow {
  const network = String(row.network);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`unexpected webhook network: ${network}`);
  }
  let events: EventKind[] = [];
  try {
    const parsed = JSON.parse(String(row.events_json ?? '[]'));
    if (Array.isArray(parsed)) events = parsed.map((e) => String(e) as EventKind);
  } catch {
    events = [];
  }
  return {
    id: String(row.id),
    apiKeyId: row.api_key_id != null ? String(row.api_key_id) : null,
    agentMint: row.agent_mint != null ? String(row.agent_mint) : null,
    network,
    url: String(row.url),
    secret: String(row.secret),
    events,
    disabledAt: row.disabled_at != null ? String(row.disabled_at) : null,
    createdAt: String(row.created_at),
  };
}

function rowToDelivery(row: Record<string, unknown>): DeliveryRow {
  return {
    id: String(row.id),
    webhookId: String(row.webhook_id),
    eventId: String(row.event_id),
    payloadJson: String(row.payload_json),
    attempts: Number(row.attempts ?? 0),
    delivered: Number(row.delivered ?? 0) === 1,
    nextAttemptAt: String(row.next_attempt_at),
    lastStatus: row.last_status != null ? Number(row.last_status) : null,
    lastError: row.last_error != null ? String(row.last_error) : null,
    lastAttemptAt: row.last_attempt_at != null ? String(row.last_attempt_at) : null,
    createdAt: String(row.created_at),
  };
}

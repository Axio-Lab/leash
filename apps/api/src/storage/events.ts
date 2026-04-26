/**
 * Event lifecycle repository.
 *
 * Each prepared transaction creates a row with `phase=prepared`; submit
 * advances to `phase=submitted` and writes the signature; a background
 * confirmation poller flips it to `confirmed` or `failed`. The same
 * table powers infra metrics and the explorer's per-agent activity feed.
 */

import { ulid } from 'ulid';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';

export type EventKind =
  | 'agent.create'
  | 'agent.identity.register'
  | 'agent.executive.register'
  | 'agent.executive.delegate'
  | 'agent.delegation.set'
  | 'agent.delegation.revoke'
  | 'agent.treasury.provision'
  | 'agent.treasury.withdraw'
  | 'agent.treasury.withdraw_sol'
  | 'agent.treasury.fund'
  | 'agent.treasury.fund_sol'
  | 'agent.token.set'
  | 'submit.raw'
  | 'receipt.published'
  | 'receipt.pulled'
  | 'payment_link.created'
  | 'payment_link.updated'
  | 'payment_link.deleted'
  | 'payment_link.served'
  | 'payment_link.settled'
  | 'buyer.payment.prepare'
  /**
   * 1% Leash protocol fee collected (one per settled earn receipt that
   * carries a `price.fee` field). Emitted by the receipts ingest path
   * (paywall + `/v1/receipts`) and surfaced in the explorer's
   * "Protocol fees" feed. Metadata always carries
   * `{ fee_amount, gross_amount, net_amount, fee_bps, fee_authority,
   *   currency, asset, receipt_hash, tx_sig? }` so the dashboard can
   * render every row without re-parsing the raw receipt blob.
   */
  | 'protocol.fee.collected';

export type EventPhase = 'prepared' | 'submitted' | 'confirmed' | 'failed';

export type EventRow = {
  id: string;
  ts: string;
  kind: EventKind;
  phase: EventPhase;
  network: SvmNetwork;
  apiKeyId: string | null;
  clientReference: string | null;
  agentAsset: string | null;
  signature: string | null;
  mint: string | null;
  amountAtomic: string | null;
  metadata: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  confirmedAt: string | null;
  failedAt: string | null;
};

export type CreatePreparedInput = {
  kind: EventKind;
  network: SvmNetwork;
  apiKeyId?: string | null;
  clientReference?: string | null;
  agentAsset?: string | null;
  mint?: string | null;
  amountAtomic?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createPreparedEvent(
  db: DbClient,
  input: CreatePreparedInput,
): Promise<string> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO events (id, kind, phase, network, api_key_id, client_reference,
                         agent_asset, mint, amount_atomic, metadata_json)
       VALUES (?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.kind,
      input.network,
      input.apiKeyId ?? null,
      input.clientReference ?? null,
      input.agentAsset ?? null,
      input.mint ?? null,
      input.amountAtomic ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  // The `prepared` phase is a meaningful event for webhook
  // subscribers — they want to know a tx is in flight even before it
  // settles on chain.
  await fanoutEvent(db, id);
  return id;
}

export async function markSubmitted(db: DbClient, id: string, signature: string): Promise<void> {
  await execute(
    db,
    `UPDATE events SET phase = 'submitted', signature = ?
       WHERE id = ? AND phase IN ('prepared','submitted')`,
    [signature, id],
  );
  await fanoutEvent(db, id);
}

export async function markConfirmed(db: DbClient, id: string): Promise<void> {
  await execute(
    db,
    `UPDATE events SET phase = 'confirmed', confirmed_at = datetime('now')
       WHERE id = ?`,
    [id],
  );
  await fanoutEvent(db, id);
}

export async function markFailed(
  db: DbClient,
  id: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await execute(
    db,
    `UPDATE events SET phase = 'failed', error_code = ?, error_message = ?, failed_at = datetime('now')
       WHERE id = ?`,
    [errorCode, errorMessage, id],
  );
  await fanoutEvent(db, id);
}

/**
 * Best-effort fanout for an event id. Looks the row up once and runs
 * three independent side-effects in parallel:
 *   1. Webhook delivery enqueue (durable, retries, signed POST).
 *   2. Live pub/sub publish (ephemeral, used by Explorer SSE).
 * Errors in either branch are swallowed — neither must ever fail the
 * underlying API call. The lazy imports keep the events module free
 * of hard dependencies on the webhook + pubsub subsystems.
 */
async function fanoutEvent(db: DbClient, id: string): Promise<void> {
  try {
    const row = await getEventById(db, id);
    if (!row) return;
    const [{ enqueueDeliveriesForEvent }, { publishLiveEvent }] = await Promise.all([
      import('./webhooks.js'),
      import('./events-pubsub.js'),
    ]);
    await Promise.all([
      enqueueDeliveriesForEvent(db, row).catch(() => undefined),
      publishLiveEvent(row).catch(() => undefined),
    ]);
  } catch {
    // intentionally swallowed
  }
}

export async function getEventById(db: DbClient, id: string): Promise<EventRow | null> {
  const res = await execute(db, `SELECT * FROM events WHERE id = ? LIMIT 1`, [id]);
  const row = res.rows[0];
  if (!row) return null;
  return rowToEvent(row);
}

export type ListEventsArgs = {
  network: SvmNetwork;
  kind?: EventKind | null;
  agent?: string | null;
  cursor?: string | null;
  limit?: number;
};

export type IngestChainEventInput = {
  kind: EventKind;
  network: SvmNetwork;
  signature: string;
  agentAsset?: string | null;
  mint?: string | null;
  amountAtomic?: string | null;
  metadata?: Record<string, unknown>;
  blockTime?: number | null;
  failed?: boolean;
};

export type IngestChainEventResult = {
  eventId: string;
  duplicate: boolean;
};

/**
 * Insert (or no-op) a chain-observed event row.
 *
 * Dedup is by `(network, signature, kind)` — the same signature can
 * legitimately produce multiple kinds (e.g. an `Execute` that withdraws
 * 3 different SPL mints emits 3 `agent.treasury.withdraw` rows, one per
 * mint). The unique index on `(network, signature)` is partial and
 * filters out NULL signatures only — we re-check at the application
 * level so we can support the multi-kind case.
 *
 * Phase is `'confirmed'` (chain receipts are inherently terminal) or
 * `'failed'` when the on-chain transaction errored.
 */
export async function ingestChainEvent(
  db: DbClient,
  input: IngestChainEventInput,
): Promise<IngestChainEventResult> {
  // Look for an existing row for this (network, signature, kind, mint?)
  // tuple. We include `mint` because multi-mint withdraw bundles emit
  // one row per mint and they must not collide.
  const existing = await execute(
    db,
    `SELECT id FROM events
       WHERE network = ? AND signature = ? AND kind = ?
         AND IFNULL(mint,'') = IFNULL(?,'') LIMIT 1`,
    [input.network, input.signature, input.kind, input.mint ?? null],
  );
  if (existing.rows[0]?.id != null) {
    return { eventId: String(existing.rows[0].id), duplicate: true };
  }
  const id = ulid();
  const phase: EventPhase = input.failed ? 'failed' : 'confirmed';
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.blockTime != null ? { block_time: input.blockTime } : {}),
    source: 'indexer',
  };
  await execute(
    db,
    `INSERT INTO events (id, kind, phase, network, agent_asset, signature,
                         mint, amount_atomic, metadata_json,
                         confirmed_at, failed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
         CASE WHEN ?='confirmed' THEN datetime('now') ELSE NULL END,
         CASE WHEN ?='failed' THEN datetime('now') ELSE NULL END)`,
    [
      id,
      input.kind,
      phase,
      input.network,
      input.agentAsset ?? null,
      input.signature,
      input.mint ?? null,
      input.amountAtomic ?? null,
      JSON.stringify(metadata),
      phase,
      phase,
    ],
  );
  await fanoutEvent(db, id);
  return { eventId: id, duplicate: false };
}

/**
 * Pull every event row decoded from a single on-chain transaction
 * signature, on the given network. Used by the explorer's `/tx/<sig>`
 * page so it can render every withdrawn mint as its own decoded row
 * without depending on a wide `LIMIT 200` scan.
 *
 * Returned ordering is `id ASC` (insert order = decode order); callers
 * typically render the first row as the "head" of the lifecycle.
 */
export async function listEventsForSignature(
  db: DbClient,
  network: SvmNetwork,
  signature: string,
): Promise<EventRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM events WHERE network = ? AND signature = ? ORDER BY id ASC`,
    [network, signature],
  );
  return res.rows.map(rowToEvent);
}

export async function listEvents(db: DbClient, args: ListEventsArgs): Promise<EventRow[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const filters: string[] = [`network = ?`];
  const values: (string | number)[] = [args.network];
  if (args.kind) {
    filters.push(`kind = ?`);
    values.push(args.kind);
  }
  if (args.agent) {
    filters.push(`agent_asset = ?`);
    values.push(args.agent);
  }
  if (args.cursor) {
    filters.push(`id < ?`);
    values.push(args.cursor);
  }
  const sql = `SELECT * FROM events WHERE ${filters.join(' AND ')} ORDER BY id DESC LIMIT ${limit}`;
  const res = await execute(db, sql, values);
  return res.rows.map(rowToEvent);
}

function rowToEvent(row: Record<string, unknown>): EventRow {
  const network = String(row.network);
  const phase = String(row.phase);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`event has unexpected network: ${network}`);
  }
  if (
    phase !== 'prepared' &&
    phase !== 'submitted' &&
    phase !== 'confirmed' &&
    phase !== 'failed'
  ) {
    throw new Error(`event has unexpected phase: ${phase}`);
  }
  let metadata: Record<string, unknown> = {};
  if (row.metadata_json != null) {
    try {
      metadata = JSON.parse(String(row.metadata_json));
    } catch {
      metadata = {};
    }
  }
  return {
    id: String(row.id),
    ts: String(row.ts),
    kind: String(row.kind) as EventKind,
    phase: phase as EventPhase,
    network,
    apiKeyId: row.api_key_id != null ? String(row.api_key_id) : null,
    clientReference: row.client_reference != null ? String(row.client_reference) : null,
    agentAsset: row.agent_asset != null ? String(row.agent_asset) : null,
    signature: row.signature != null ? String(row.signature) : null,
    mint: row.mint != null ? String(row.mint) : null,
    amountAtomic: row.amount_atomic != null ? String(row.amount_atomic) : null,
    metadata,
    errorCode: row.error_code != null ? String(row.error_code) : null,
    errorMessage: row.error_message != null ? String(row.error_message) : null,
    confirmedAt: row.confirmed_at != null ? String(row.confirmed_at) : null,
    failedAt: row.failed_at != null ? String(row.failed_at) : null,
  };
}

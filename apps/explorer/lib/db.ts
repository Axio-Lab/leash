/**
 * Direct database access for the explorer.
 *
 * The explorer is the fourth process inside the Leash infra boundary
 * (api, indexer, webhook worker, explorer). It reads the same Turso /
 * libsql database the API and indexer write to — no HTTP hop, no API
 * key — and shapes rows into the snake_case wire types the views
 * already consume.
 *
 * On first use we call `@leashmarket/api`'s `runMigrations` against this
 * client (same CREATE TABLE IF NOT EXISTS as the API bootstrap), so a
 * brand-new `file:…` path gets an empty but valid schema instead of
 * "no such table: events".
 *
 * Configure with these env vars (shared with the API / indexer):
 *
 *   LEASH_DB_URL          libsql:// URL (or `file:./.leash-api.db` for
 *                         a local SQLite, mirroring the API default)
 *   LEASH_DB_AUTH_TOKEN   only for hosted Turso
 *
 * For backwards compatibility we also accept `LEASH_API_DB_URL` /
 * `LEASH_API_DB_AUTH_TOKEN`, which is what the API process itself
 * already reads — that lets devs point both processes at the same DB
 * with one env file.
 */

import { createClient, type Client } from '@libsql/client';
import {
  getEventById as apiGetEventById,
  getIndexerStatus as apiGetIndexerStatus,
  getReceiptByHash as apiGetReceiptByHash,
  listRecentReceipts as apiListRecentReceipts,
  listEvents as apiListEvents,
  listEventsForSignature as apiListEventsForSignature,
  listReceipts as apiListReceipts,
  runMigrations,
  type EventKind,
  type EventRow as ApiEventRow,
  type ReceiptRow as ApiReceiptRow,
} from '@leashmarket/api';

import type { Network } from './network';
import { networkToSlug } from './network';
import type { EventPage, EventRow, IndexerStatus, ReceiptPage, ReceiptRow } from './types';

let cached: Client | null = null;
/** First-connection schema (same SQL as the API bootstrap). Idempotent. */
let schemaPromise: Promise<void> | null = null;

function dbUrl(): string {
  return process.env.LEASH_DB_URL || process.env.LEASH_API_DB_URL || 'file:./.leash-api.db';
}

function dbAuthToken(): string | undefined {
  return process.env.LEASH_DB_AUTH_TOKEN || process.env.LEASH_API_DB_AUTH_TOKEN;
}

export function getDb(): Client {
  if (cached != null) return cached;
  const url = dbUrl();
  const token = dbAuthToken();
  cached = createClient({ url, ...(token ? { authToken: token } : {}) });
  return cached;
}

/** Test-only: drop the singleton so each test gets a fresh client. */
export function _resetDbForTests(): void {
  cached = null;
  schemaPromise = null;
}

async function ensureSchema(db: Client): Promise<void> {
  if (schemaPromise == null) {
    schemaPromise = runMigrations(db).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbUnavailableError';
  }
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = getDb();
  try {
    await ensureSchema(db);
    return await fn(db);
  } catch (err) {
    throw new DbUnavailableError(`Leash DB unreachable (${dbUrl()}): ${(err as Error).message}`);
  }
}

// --- mapping helpers ------------------------------------------------

function eventToRow(row: ApiEventRow): EventRow {
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind,
    phase: row.phase,
    network: row.network,
    client_reference: row.clientReference,
    agent_asset: row.agentAsset,
    signature: row.signature,
    mint: row.mint,
    amount_atomic: row.amountAtomic,
    metadata: row.metadata,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    confirmed_at: row.confirmedAt,
    failed_at: row.failedAt,
  };
}

function receiptToRow(row: ApiReceiptRow): ReceiptRow {
  // Wrapper row carries ingested_at + receipt_hash for cursoring; views render
  // the typed receipt in `raw` (v0.1 or v0.2 dual-protocol).
  return row.raw;
}

// --- page-facing reads ----------------------------------------------

export type ListEventsOptions = {
  network: Network;
  kind?: string;
  agent?: string;
  cursor?: string;
  limit?: number;
};

export async function listEvents(opts: ListEventsOptions): Promise<EventPage> {
  const limit = opts.limit ?? 15;
  const items = await withDb((db) =>
    apiListEvents(db, {
      network: networkToSlug(opts.network),
      ...(opts.kind ? { kind: opts.kind as EventKind } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      limit,
    }),
  );
  const next_cursor =
    items.length > 0 && items.length === limit ? items[items.length - 1]!.id : null;
  return { items: items.map(eventToRow), next_cursor };
}

export async function getEventById(network: Network, id: string): Promise<EventRow | null> {
  const row = await withDb((db) => apiGetEventById(db, id));
  if (!row) return null;
  if (row.network !== networkToSlug(network)) return null;
  return eventToRow(row);
}

export async function listEventsForSignature(
  network: Network,
  signature: string,
): Promise<EventRow[]> {
  const rows = await withDb((db) =>
    apiListEventsForSignature(db, networkToSlug(network), signature),
  );
  return rows.map(eventToRow);
}

export async function listReceipts(opts: {
  network: Network;
  agent: string;
  cursor?: string;
  limit?: number;
  kind?: 'spend' | 'earn';
}): Promise<ReceiptPage> {
  const limit = opts.limit ?? 25;
  const rows = await withDb((db) =>
    apiListReceipts(db, {
      network: networkToSlug(opts.network),
      agent: opts.agent,
      cursor: opts.cursor ?? null,
      kind: opts.kind ?? null,
      limit,
    }),
  );
  const last = rows[rows.length - 1];
  const next_cursor =
    last && rows.length === limit ? `${last.ingestedAt}|${last.receiptHash}` : null;
  return { items: rows.map(receiptToRow), next_cursor };
}

export async function getReceiptByHash(network: Network, hash: string): Promise<ReceiptRow | null> {
  const row = await withDb((db) => apiGetReceiptByHash(db, networkToSlug(network), hash));
  if (!row) return null;
  return receiptToRow(row);
}

/**
 * Cross-agent recent-receipts feed for the homepage panel and the
 * `/receipts` page. Reads straight from the receipts table so we
 * don't depend on event metadata having `receipt_hash` populated
 * (older rows didn't).
 */
export async function listRecentReceipts(opts: {
  network: Network;
  limit?: number;
  cursor?: string;
  kind?: 'spend' | 'earn';
}): Promise<ReceiptPage> {
  const limit = opts.limit ?? 15;
  const rows = await withDb((db) =>
    apiListRecentReceipts(db, networkToSlug(opts.network), {
      limit,
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
    }),
  );
  // Pull cursor metadata off the underlying ApiReceiptRow, before we
  // strip it down to the inner receipt in receiptToRow.
  const last = rows[rows.length - 1];
  const next_cursor =
    last && rows.length === limit ? `${last.ingestedAt}|${last.receiptHash}` : null;
  return { items: rows.map(receiptToRow), next_cursor };
}

export async function getIndexerStatus(network: Network): Promise<IndexerStatus> {
  return withDb((db) => apiGetIndexerStatus(db, networkToSlug(network)));
}

/**
 * Summary of all `protocol.fee.collected` events on a network, grouped
 * by mint. Powers the explorer's "Protocol fees" panel — total revenue
 * per stablecoin since the rollout, plus a count of settled calls.
 *
 * We sum from the events table (not the receipts table) because the
 * receipt-side ingest is best-effort and the chain-side detection
 * (decoder + watchlist) covers the gap; together they're the authoritative
 * source of truth for protocol revenue.
 */
export type ProtocolFeeMintTotal = {
  mint: string | null;
  currency: string | null;
  totalAtomic: string;
  count: number;
};

export async function listProtocolFeeTotals(network: Network): Promise<ProtocolFeeMintTotal[]> {
  const rows = await withDb(async (db) => {
    // We sum amount_atomic as integers via SUM(CAST(... AS INTEGER));
    // SQLite handles bigint up to ~2^63 which is plenty for stablecoin
    // revenue (1B USDC = 1e15 atoms = ~2^50). Currency comes from the
    // metadata blob — newer rows always carry it; older / chain-side
    // rows may be null, so we coalesce to JSON-extract the field.
    const sql = `SELECT mint,
                        json_extract(metadata_json, '$.currency') AS currency,
                        COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) AS total_atomic,
                        COUNT(*) AS n
                   FROM events
                  WHERE network = ?
                    AND kind = 'protocol.fee.collected'
                  GROUP BY mint, currency
                  ORDER BY total_atomic DESC`;
    const res = await db.execute({ sql, args: [networkToSlug(network)] });
    return res.rows;
  });
  return rows.map((r) => ({
    mint: r.mint != null ? String(r.mint) : null,
    currency: r.currency != null ? String(r.currency) : null,
    totalAtomic: String(r.total_atomic ?? '0'),
    count: Number(r.n ?? 0),
  }));
}

/**
 * All-time stablecoin settlement totals for a network.
 *
 * Sums `price.amount` and `price.fee` from every `earn` receipt
 * (so each x402 settlement counts once — every settlement creates
 * paired earn + spend receipts). Stables are USDC/USDG/USDT, all
 * 6-decimals 1:1-to-USD, so the SQL can sum atomic ints and the
 * caller divides by 1e6 to get USD without per-mint arithmetic.
 *
 * The receipts table stores the canonical receipt JSON (`ReceiptAny`) as
 * `raw_json`, so we extract the relevant scalars via `json_extract`.
 * Receipts that lack a `price.amount` (rare — e.g. legacy denied
 * rows) are simply skipped via the `WHERE` clause.
 */
export type SettlementTotals = {
  /** USD-equivalent gross volume (sum of `price.amount`), human units. */
  gross_usd: number;
  /** USD-equivalent protocol fees collected (sum of `price.fee`). */
  fees_usd: number;
  /** Number of distinct earn receipts that contributed to the totals. */
  settled_count: number;
};

const STABLE_DECIMALS = 6;

export async function getSettlementTotals(network: Network): Promise<SettlementTotals> {
  const row = await withDb(async (db) => {
    const sql = `SELECT
        COALESCE(SUM(CAST(json_extract(raw_json, '$.price.amount') AS INTEGER)), 0) AS gross_atomic,
        COALESCE(SUM(CAST(json_extract(raw_json, '$.price.fee') AS INTEGER)), 0)    AS fee_atomic,
        COUNT(*) AS n
       FROM receipts
       WHERE network = ?
         AND kind = 'earn'
         AND json_extract(raw_json, '$.price.amount') IS NOT NULL`;
    const res = await db.execute({ sql, args: [networkToSlug(network)] });
    return res.rows[0] ?? null;
  });
  if (!row) return { gross_usd: 0, fees_usd: 0, settled_count: 0 };
  const grossAtomic = Number(row.gross_atomic ?? 0);
  const feeAtomic = Number(row.fee_atomic ?? 0);
  const divisor = 10 ** STABLE_DECIMALS;
  return {
    gross_usd: grossAtomic / divisor,
    fees_usd: feeAtomic / divisor,
    settled_count: Number(row.n ?? 0),
  };
}

/**
 * For each `tx_sig`, return the (payer, receiver) agent pair derived
 * from the receipts table — buyer-side `spend` receipts give us the
 * payer, seller-side `earn` receipts give us the receiver. When only
 * one side is present (no counterparty receipt has been ingested) the
 * other field is `null` so the UI can render "—".
 *
 * This is the explorer's per-row counterparty lookup: the receipts
 * panel calls it once per page load with the tx signatures it's about
 * to render, so the table can show "Payer ↔ Receiver" without
 * round-tripping the indexer for each row.
 */
export async function getCounterpartiesForTxs(
  network: Network,
  txSigs: ReadonlyArray<string>,
): Promise<Map<string, { payer: string | null; receiver: string | null }>> {
  const map = new Map<string, { payer: string | null; receiver: string | null }>();
  // Filter to non-empty unique sigs. Bail if there's nothing to ask.
  const sigs = Array.from(new Set(txSigs.filter((s): s is string => !!s && s.length > 0)));
  if (sigs.length === 0) return map;
  const placeholders = sigs.map(() => '?').join(',');
  const sql = `SELECT tx_sig, kind, agent FROM receipts
               WHERE network = ? AND tx_sig IN (${placeholders})`;
  const rows = await withDb(async (db) => {
    const res = await db.execute({ sql, args: [networkToSlug(network), ...sigs] });
    return res.rows;
  });
  for (const row of rows) {
    const sig = String(row.tx_sig ?? '');
    if (!sig) continue;
    const kind = String(row.kind ?? '');
    const agent = String(row.agent ?? '');
    const cur = map.get(sig) ?? { payer: null, receiver: null };
    if (kind === 'spend') cur.payer = agent;
    else if (kind === 'earn') cur.receiver = agent;
    map.set(sig, cur);
  }
  return map;
}

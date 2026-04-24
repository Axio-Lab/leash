/**
 * Direct database access for the explorer.
 *
 * The explorer is the fourth process inside the Leash infra boundary
 * (api, indexer, webhook worker, explorer). It reads the same Turso /
 * libsql database the API and indexer write to — no HTTP hop, no API
 * key — and shapes rows into the snake_case wire types the views
 * already consume.
 *
 * On first use we call `@leash/api`'s `runMigrations` against this
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
  listEvents as apiListEvents,
  listEventsForSignature as apiListEventsForSignature,
  listReceipts as apiListReceipts,
  runMigrations,
  type EventKind,
  type EventRow as ApiEventRow,
  type ReceiptRow as ApiReceiptRow,
} from '@leash/api';

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
  // The wrapper carries (network, ingested_at, …) but the views render
  // the inner ReceiptV1 directly (price, request_hash, prev_receipt_hash,
  // ts, …). Surfacing `raw` keeps every page that already worked off
  // the public API response shape unchanged.
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
  const limit = opts.limit ?? 50;
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

export async function getIndexerStatus(network: Network): Promise<IndexerStatus> {
  return withDb((db) => apiGetIndexerStatus(db, networkToSlug(network)));
}

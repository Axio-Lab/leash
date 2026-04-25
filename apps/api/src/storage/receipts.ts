/**
 * Receipts repository.
 *
 * Receipts are the off-chain audit trail produced by `@leash/buyer-kit`
 * and `@leash/seller-kit` on every paid call (or denied attempt). The
 * Leash runner stores them in-memory; the API mirrors them into Turso so
 * they survive restarts, become queryable across agents, and feed the
 * explorer's per-agent receipt feed.
 *
 * Storage rules:
 *   - Primary key is `(network, receipt_hash)` so the same hash can
 *     theoretically exist on devnet and mainnet without colliding (the
 *     per-network isolation invariant we promise everywhere).
 *   - Inserts are idempotent (`INSERT OR IGNORE`). Re-posting a receipt
 *     never causes a duplicate row, never bumps `ingested_at`, and the
 *     caller still gets back the canonical receipt + a `duplicate: true`
 *     flag so they know nothing new happened.
 *   - Ingest is best-effort from the buyer/seller kit's POV: a failure
 *     here must never break a payment flow. The Hono route reflects
 *     that by returning JSON errors with detail rather than throwing.
 */

import type { ReceiptV1 } from '@leash/schemas';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';

export type IngestReceiptArgs = {
  network: SvmNetwork;
  receipt: ReceiptV1;
};

export type IngestReceiptResult = {
  receiptHash: string;
  duplicate: boolean;
};

/**
 * Insert a receipt, idempotent on `(network, receipt_hash)`.
 *
 * Returns `{ duplicate: true }` when the row already existed. The caller
 * (HTTP route) uses that to skip the `receipt.published` event write so
 * we don't pollute the explorer's activity feed with replays.
 */
export async function ingestReceipt(
  db: DbClient,
  args: IngestReceiptArgs,
): Promise<IngestReceiptResult> {
  const r = args.receipt;
  // Ensure the receipt row carries the same `network` slug as the
  // calling API key — buyer/seller kits set `price.network`, but a
  // denied call has `price = null`, so we trust the auth-derived
  // network as the source of truth here.
  const res = await execute(
    db,
    `INSERT OR IGNORE INTO receipts (
       receipt_hash, network, agent, nonce, decision, kind,
       tx_sig, payment_requirements_hash, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.receipt_hash,
      args.network,
      r.agent,
      r.nonce,
      r.decision,
      r.kind,
      r.tx_sig ?? null,
      r.payment_requirements_hash ?? null,
      JSON.stringify(r),
    ],
  );
  // libsql returns `rowsAffected: 0` when `OR IGNORE` skipped the row.
  const duplicate = (res.rowsAffected ?? 0) === 0;
  return { receiptHash: r.receipt_hash, duplicate };
}

export type ListReceiptsArgs = {
  network: SvmNetwork;
  agent: string;
  cursor?: string | null;
  limit?: number;
  kind?: 'spend' | 'earn' | null;
};

export type ReceiptRow = {
  receiptHash: string;
  network: SvmNetwork;
  agent: string;
  nonce: number;
  decision: string;
  kind: string;
  txSig: string | null;
  paymentRequirementsHash: string | null;
  ingestedAt: string;
  raw: ReceiptV1;
};

export async function listReceipts(db: DbClient, args: ListReceiptsArgs): Promise<ReceiptRow[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const filters: string[] = ['network = ?', 'agent = ?'];
  const values: (string | number)[] = [args.network, args.agent];
  if (args.kind) {
    filters.push('kind = ?');
    values.push(args.kind);
  }
  if (args.cursor) {
    // Cursor is the last-seen `(ingested_at, receipt_hash)` pair encoded
    // as `<isots>|<hash>`. Splitting client-side keeps the SQL simple
    // and avoids SQLite's lack of multi-column ORDER cursors.
    const sep = args.cursor.indexOf('|');
    if (sep > 0) {
      const ts = args.cursor.slice(0, sep);
      const hash = args.cursor.slice(sep + 1);
      filters.push('(ingested_at < ? OR (ingested_at = ? AND receipt_hash < ?))');
      values.push(ts, ts, hash);
    }
  }
  const sql = `SELECT * FROM receipts WHERE ${filters.join(' AND ')}
               ORDER BY ingested_at DESC, receipt_hash DESC LIMIT ${limit}`;
  const res = await execute(db, sql, values);
  return res.rows.map(rowToReceipt);
}

export async function getReceiptByHash(
  db: DbClient,
  network: SvmNetwork,
  hash: string,
): Promise<ReceiptRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM receipts WHERE network = ? AND receipt_hash = ? LIMIT 1`,
    [network, hash],
  );
  const row = res.rows[0];
  if (!row) return null;
  return rowToReceipt(row);
}

/**
 * Cross-agent recent-receipts feed used by the explorer homepage and
 * the dedicated `/receipts` listing. The receipts table is the source
 * of truth — this avoids the explorer having to triangulate via
 * `events.metadata.receipt_hash` (which only works for events emitted
 * after we started writing that field).
 *
 * Pagination uses the same `(ingested_at, receipt_hash)` cursor shape
 * as `listReceipts`, encoded as `<isots>|<hash>`.
 */
export async function listRecentReceipts(
  db: DbClient,
  network: SvmNetwork,
  opts: { limit?: number; cursor?: string | null; kind?: 'spend' | 'earn' | null } = {},
): Promise<ReceiptRow[]> {
  const capped = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  const filters: string[] = ['network = ?'];
  const values: (string | number)[] = [network];
  if (opts.kind) {
    filters.push('kind = ?');
    values.push(opts.kind);
  }
  if (opts.cursor) {
    const sep = opts.cursor.indexOf('|');
    if (sep > 0) {
      const ts = opts.cursor.slice(0, sep);
      const hash = opts.cursor.slice(sep + 1);
      filters.push('(ingested_at < ? OR (ingested_at = ? AND receipt_hash < ?))');
      values.push(ts, ts, hash);
    }
  }
  const res = await execute(
    db,
    `SELECT * FROM receipts WHERE ${filters.join(' AND ')}
       ORDER BY ingested_at DESC, receipt_hash DESC LIMIT ${capped}`,
    values,
  );
  return res.rows.map(rowToReceipt);
}

function rowToReceipt(row: Record<string, unknown>): ReceiptRow {
  const network = String(row.network);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`receipt has unexpected network: ${network}`);
  }
  let raw: ReceiptV1;
  try {
    raw = JSON.parse(String(row.raw_json)) as ReceiptV1;
  } catch (err) {
    throw new Error(`receipt raw_json is corrupt: ${(err as Error).message}`);
  }
  return {
    receiptHash: String(row.receipt_hash),
    network,
    agent: String(row.agent),
    nonce: Number(row.nonce),
    decision: String(row.decision),
    kind: String(row.kind),
    txSig: row.tx_sig != null ? String(row.tx_sig) : null,
    paymentRequirementsHash:
      row.payment_requirements_hash != null ? String(row.payment_requirements_hash) : null,
    ingestedAt: String(row.ingested_at),
    raw,
  };
}

// ---------------------------------------------------------------------
// pull_targets — `services.receipts` URLs the API will poll on a cadence
// ---------------------------------------------------------------------

export type PullTargetRow = {
  id: number;
  network: SvmNetwork;
  agent: string;
  url: string;
  lastPolledAt: string | null;
  lastCursor: string | null;
};

export async function upsertPullTarget(
  db: DbClient,
  args: { network: SvmNetwork; agent: string; url: string },
): Promise<void> {
  await execute(db, `INSERT OR IGNORE INTO pull_targets (network, agent, url) VALUES (?, ?, ?)`, [
    args.network,
    args.agent,
    args.url,
  ]);
}

export async function listPullTargets(
  db: DbClient,
  args: { network: SvmNetwork; agent: string },
): Promise<PullTargetRow[]> {
  const res = await execute(
    db,
    `SELECT id, network, agent, url, last_polled_at, last_cursor
       FROM pull_targets WHERE network = ? AND agent = ? ORDER BY id ASC`,
    [args.network, args.agent],
  );
  return res.rows.map((row) => {
    const network = String(row.network);
    if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
      throw new Error(`pull target has unexpected network: ${network}`);
    }
    return {
      id: Number(row.id),
      network,
      agent: String(row.agent),
      url: String(row.url),
      lastPolledAt: row.last_polled_at != null ? String(row.last_polled_at) : null,
      lastCursor: row.last_cursor != null ? String(row.last_cursor) : null,
    };
  });
}

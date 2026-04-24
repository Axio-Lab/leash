/**
 * Indexer watchlist + cursor storage.
 *
 * The indexer never scans the entire mpl-agent-identity / mpl-core
 * program — that would mean millions of unrelated signatures. Instead,
 * every agent the API touches is added to the per-network watchlist
 * with two entries:
 *
 *   - `kind='asset'`    — the agent's mpl-core asset pubkey (mint).
 *                         Captures identity registration, executive
 *                         setup, delegation flips, agent-token launch.
 *   - `kind='treasury'` — the asset signer PDA derived from the asset.
 *                         Captures every withdraw (`Execute` against
 *                         the PDA) and every ATA provisioning.
 *
 * Cursors are tracked per `(network, address, kind)` — when the indexer
 * pages through `getSignaturesForAddress(address)`, it stops at
 * `last_signature` so subsequent runs only see new tx.
 */

import type { DbClient } from '../storage/turso.js';
import { execute } from '../storage/turso.js';
import type { SvmNetwork } from '../util/network.js';

export type WatchKind = 'asset' | 'treasury';

export type WatchRow = {
  network: SvmNetwork;
  address: string;
  kind: WatchKind;
  agentAsset: string;
  addedAt: string;
};

/**
 * Idempotently add a `(asset, treasury)` pair to the watchlist for a
 * network. Safe to call from any route that learns about a new agent;
 * subsequent calls are no-ops.
 */
export async function ensureWatched(
  db: DbClient,
  args: { network: SvmNetwork; agentAsset: string; treasuryAddress: string },
): Promise<void> {
  await execute(
    db,
    `INSERT OR IGNORE INTO indexer_watchlist (network, address, kind, agent_asset)
       VALUES (?, ?, 'asset', ?)`,
    [args.network, args.agentAsset, args.agentAsset],
  );
  await execute(
    db,
    `INSERT OR IGNORE INTO indexer_watchlist (network, address, kind, agent_asset)
       VALUES (?, ?, 'treasury', ?)`,
    [args.network, args.treasuryAddress, args.agentAsset],
  );
}

export async function listWatchlist(db: DbClient, network: SvmNetwork): Promise<WatchRow[]> {
  const res = await execute(
    db,
    `SELECT network, address, kind, agent_asset, added_at
       FROM indexer_watchlist WHERE network = ? ORDER BY added_at ASC`,
    [network],
  );
  return res.rows.map((row) => {
    const kind = String(row.kind);
    if (kind !== 'asset' && kind !== 'treasury') {
      throw new Error(`watchlist row has unexpected kind: ${kind}`);
    }
    const networkStr = String(row.network);
    if (networkStr !== 'solana-devnet' && networkStr !== 'solana-mainnet') {
      throw new Error(`watchlist row has unexpected network: ${networkStr}`);
    }
    return {
      network: networkStr,
      address: String(row.address),
      kind,
      agentAsset: String(row.agent_asset),
      addedAt: String(row.added_at),
    };
  });
}

export type CursorRow = {
  network: SvmNetwork;
  address: string;
  kind: string;
  lastSignature: string | null;
  lastSlot: number | null;
  lastRunAt: string | null;
  backfillComplete: boolean;
};

export async function getCursor(
  db: DbClient,
  args: { network: SvmNetwork; address: string; kind: string },
): Promise<CursorRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM indexer_cursors WHERE network = ? AND address = ? AND kind = ? LIMIT 1`,
    [args.network, args.address, args.kind],
  );
  const row = res.rows[0];
  if (!row) return null;
  return rowToCursor(row);
}

export async function upsertCursor(
  db: DbClient,
  args: {
    network: SvmNetwork;
    address: string;
    kind: string;
    lastSignature: string | null;
    lastSlot: number | null;
    backfillComplete?: boolean;
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO indexer_cursors (network, address, kind, last_signature, last_slot,
                                  last_run_at, backfill_complete)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT (network, address, kind) DO UPDATE SET
         last_signature = excluded.last_signature,
         last_slot = excluded.last_slot,
         last_run_at = excluded.last_run_at,
         backfill_complete = excluded.backfill_complete`,
    [
      args.network,
      args.address,
      args.kind,
      args.lastSignature,
      args.lastSlot,
      args.backfillComplete === true ? 1 : 0,
    ],
  );
}

function rowToCursor(row: Record<string, unknown>): CursorRow {
  const networkStr = String(row.network);
  if (networkStr !== 'solana-devnet' && networkStr !== 'solana-mainnet') {
    throw new Error(`cursor has unexpected network: ${networkStr}`);
  }
  return {
    network: networkStr,
    address: String(row.address),
    kind: String(row.kind),
    lastSignature: row.last_signature != null ? String(row.last_signature) : null,
    lastSlot: row.last_slot != null ? Number(row.last_slot) : null,
    lastRunAt: row.last_run_at != null ? String(row.last_run_at) : null,
    backfillComplete: Number(row.backfill_complete) === 1,
  };
}

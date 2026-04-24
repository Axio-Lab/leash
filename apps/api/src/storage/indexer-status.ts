/**
 * Indexer health snapshot used by both the public `GET /v1/indexer/status`
 * endpoint and the internal explorer's `/health` page.
 *
 * Surfacing a tiny shared module here means the explorer doesn't need
 * to reach for the API's HTTP surface just to ask a question that's
 * really a 3-statement DB read.
 */

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';

export type IndexerStatus = {
  network: SvmNetwork;
  watchlist_size: number;
  cursors: {
    total: number;
    last_run_at: string | null;
  };
  events_last_hour: Record<string, number>;
};

export async function getIndexerStatus(db: DbClient, network: SvmNetwork): Promise<IndexerStatus> {
  const watch = await execute(db, `SELECT COUNT(*) AS n FROM indexer_watchlist WHERE network = ?`, [
    network,
  ]);
  const cur = await execute(
    db,
    `SELECT COUNT(*) AS n, MAX(last_run_at) AS last_run_at
       FROM indexer_cursors WHERE network = ?`,
    [network],
  );
  const ev = await execute(
    db,
    `SELECT kind, COUNT(*) AS n FROM events
       WHERE network = ? AND ts >= datetime('now','-1 hour')
       GROUP BY kind`,
    [network],
  );
  const eventsLastHour: Record<string, number> = {};
  for (const row of ev.rows) {
    eventsLastHour[String(row.kind)] = Number(row.n);
  }
  return {
    network,
    watchlist_size: Number(watch.rows[0]?.n ?? 0),
    cursors: {
      total: Number(cur.rows[0]?.n ?? 0),
      last_run_at: cur.rows[0]?.last_run_at ? String(cur.rows[0].last_run_at) : null,
    },
    events_last_hour: eventsLastHour,
  };
}

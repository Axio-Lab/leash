/**
 * Read-only indexer status endpoint.
 *
 * The chain indexer runs as a background worker (`pnpm leash-indexer`),
 * but operators want a way to see "is it caught up?" without shelling
 * onto the box. This route exposes:
 *
 *   - the watchlist size for the caller's network
 *   - the most recent cursor activity (`max(last_run_at)`)
 *   - per-kind event counts in the last hour, useful for noticing
 *     whether new on-chain activity is being picked up
 *
 * Network is bound to the API key prefix as everywhere else.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { execute } from '../storage/turso.js';
import { NetworkSchema } from '../openapi/common.js';

const StatusResponseSchema = z.object({
  network: NetworkSchema,
  watchlist_size: z.number().int().nonnegative(),
  cursors: z.object({
    total: z.number().int().nonnegative(),
    last_run_at: z.string().nullable(),
  }),
  events_last_hour: z.record(z.number().int().nonnegative()),
});

export function buildIndexerRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/indexer/status',
      tags: ['indexer'],
      summary: 'Indexer health on the caller network.',
      responses: {
        200: {
          description: 'Watchlist + cursor + recent activity counters.',
          content: { 'application/json': { schema: StatusResponseSchema } },
        },
      },
    }),
    async (c) => {
      const network = c.var.network;
      const watch = await execute(
        deps.db,
        `SELECT COUNT(*) AS n FROM indexer_watchlist WHERE network = ?`,
        [network],
      );
      const cur = await execute(
        deps.db,
        `SELECT COUNT(*) AS n, MAX(last_run_at) AS last_run_at
           FROM indexer_cursors WHERE network = ?`,
        [network],
      );
      const ev = await execute(
        deps.db,
        `SELECT kind, COUNT(*) AS n FROM events
           WHERE network = ? AND ts >= datetime('now','-1 hour')
           GROUP BY kind`,
        [network],
      );
      const eventsLastHour: Record<string, number> = {};
      for (const row of ev.rows) {
        eventsLastHour[String(row.kind)] = Number(row.n);
      }
      return c.json(
        {
          network,
          watchlist_size: Number(watch.rows[0]?.n ?? 0),
          cursors: {
            total: Number(cur.rows[0]?.n ?? 0),
            last_run_at: cur.rows[0]?.last_run_at ? String(cur.rows[0].last_run_at) : null,
          },
          events_last_hour: eventsLastHour,
        },
        200,
      );
    },
  );

  return app;
}

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
 * Network is bound to the API key prefix as everywhere else. The
 * underlying read lives in `storage/indexer-status.ts` so the
 * explorer can call it directly.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { getIndexerStatus } from '../storage/indexer-status.js';
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
      const status = await getIndexerStatus(deps.db, c.var.network);
      return c.json(status, 200);
    },
  );

  return app;
}

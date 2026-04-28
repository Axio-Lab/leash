/**
 * `/v1/stats/public` — anonymous, cached snapshot of the network.
 *
 * Surfaced by the marketing landings (agent.leash.market and
 * leash.market) as the live counter — total receipts, distinct active
 * agents, total USDC volume.
 *
 * Cached in Redis for 60s so a viral landing-page hit doesn't hammer
 * the DB. We use a tight result type because everything in here is
 * shipped to anonymous browsers — no privacy-sensitive joins.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { LeashApiConfig } from '../config.js';
import type { CacheClient } from '../storage/redis.js';
import { execute, type DbClient } from '../storage/turso.js';

const PublicStatsSchema = z
  .object({
    receipts_total: z.number().int(),
    receipts_24h: z.number().int(),
    volume_total_usdc: z.string(),
    volume_24h_usdc: z.string(),
    active_agents: z.number().int(),
    active_listings: z.number().int(),
    cached_at: z.string(),
  })
  .openapi('PublicStats');

type Stats = z.infer<typeof PublicStatsSchema>;

const CACHE_KEY = 'leash:stats:public:v1';
const CACHE_TTL_S = 60;

export type StatsDeps = { config: LeashApiConfig; db: DbClient; cache: CacheClient };

/**
 * Receipt amounts live inside `raw_json` (the persisted payment payload)
 * rather than a top-level column, so we sample-and-sum in JS rather than
 * SQL. Cap the sample at 5_000 rows — more than enough for a marketing
 * counter, cheap enough to run every 60s.
 */
async function sumReceiptVolume(db: DbClient, windowClause: string): Promise<number> {
  const r = await execute(
    db,
    `SELECT raw_json FROM receipts
     ${windowClause ? `WHERE ${windowClause}` : ''}
     ORDER BY ingested_at DESC LIMIT 5000`,
  );
  let total = 0;
  for (const row of r.rows as Array<Record<string, unknown>>) {
    const raw = row.raw_json;
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const amount =
        (parsed.settled_amount as string | undefined) ??
        (parsed.amount as string | undefined) ??
        (parsed as { details?: { amount?: string } }).details?.amount ??
        null;
      if (amount != null) {
        const n = Number(amount);
        if (Number.isFinite(n)) total += n;
      }
    } catch {
      // ignore malformed receipts in the volume estimate
    }
  }
  return total;
}

async function computeStats(db: DbClient): Promise<Stats> {
  const num = (rows: unknown, key: string) => {
    const r = rows as Array<Record<string, unknown>>;
    return Number(r[0]?.[key] ?? 0);
  };

  const safeCount = async (sql: string): Promise<number> => {
    try {
      const r = await execute(db, sql);
      return num(r.rows, 'n');
    } catch {
      return 0;
    }
  };

  const [receiptsTotal, receipts24h, volumeTotal, volume24h, activeAgents, activeListings] =
    await Promise.all([
      safeCount('SELECT COUNT(*) AS n FROM receipts'),
      safeCount(
        `SELECT COUNT(*) AS n FROM receipts WHERE ingested_at >= datetime('now', '-1 day')`,
      ),
      sumReceiptVolume(db, '').catch(() => 0),
      sumReceiptVolume(db, "ingested_at >= datetime('now', '-1 day')").catch(() => 0),
      safeCount("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'"),
      safeCount("SELECT COUNT(*) AS n FROM listings WHERE status = 'approved'"),
    ]);

  return {
    receipts_total: receiptsTotal,
    receipts_24h: receipts24h,
    volume_total_usdc: volumeTotal.toFixed(2),
    volume_24h_usdc: volume24h.toFixed(2),
    active_agents: activeAgents,
    active_listings: activeListings,
    cached_at: new Date().toISOString(),
  };
}

export function buildStatsRoutes(deps: StatsDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/stats/public',
      tags: ['stats'],
      summary: 'Public landing-page stats (cached 60s)',
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicStatsSchema } },
        },
      },
    }),
    async (c) => {
      try {
        const cached = await deps.cache.get(CACHE_KEY);
        if (cached) {
          return c.json(JSON.parse(cached) as Stats, 200);
        }
      } catch {
        // Redis is best-effort here; on miss/error we recompute.
      }
      const stats = await computeStats(deps.db);
      try {
        await deps.cache.set(CACHE_KEY, JSON.stringify(stats), { ttlSec: CACHE_TTL_S });
      } catch {
        // Same: cache miss is non-fatal.
      }
      return c.json(stats, 200);
    },
  );
  return app;
}

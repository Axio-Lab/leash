/**
 * Metrics dashboards.
 *
 * Two views, both scoped to the caller's API key + network:
 *   - GET /v1/metrics/usage   — daily request rollups (total, errors, p95)
 *                                from `api_requests`.
 *   - GET /v1/metrics/events  — counts by phase + kind from `events`.
 *
 * These power the operator dashboard and customer-facing usage views.
 * Heavy aggregations are bounded to the last 30 days; longer windows
 * should be served from a periodic rollup job.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { execute } from '../storage/turso.js';
import { NetworkSchema } from '../openapi/common.js';

const UsageDaySchema = z.object({
  date: z.string(),
  requests: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  avg_latency_ms: z.number().nonnegative(),
  p95_latency_ms: z.number().nonnegative(),
});

const UsageResponseSchema = z.object({
  network: NetworkSchema,
  api_key_id: z.string(),
  window_days: z.number().int().positive(),
  totals: z.object({
    requests: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    avg_latency_ms: z.number().nonnegative(),
  }),
  by_day: z.array(UsageDaySchema),
  by_endpoint: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      requests: z.number().int().nonnegative(),
      errors: z.number().int().nonnegative(),
    }),
  ),
});

const EventCountsSchema = z.object({
  network: NetworkSchema,
  window_hours: z.number().int().positive(),
  by_phase: z.record(z.number().int().nonnegative()),
  by_kind: z.record(z.number().int().nonnegative()),
  failure_rate: z.number().min(0).max(1),
});

export function buildMetricsRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  // GET /v1/metrics/usage
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/metrics/usage',
      tags: ['metrics'],
      summary: 'Per-day API request rollups for the caller key.',
      request: {
        query: z.object({
          days: z.coerce.number().int().min(1).max(30).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Usage rollups + endpoint breakdown.',
          content: { 'application/json': { schema: UsageResponseSchema } },
        },
      },
    }),
    async (c) => {
      const days = c.req.valid('query').days ?? 7;
      const apiKey = c.var.apiKey;
      const network = c.var.network;
      const sinceClause = `datetime('now', '-${days} day')`;

      // Sample latencies for an approximate p95 per day. SQLite has no
      // PERCENTILE_CONT, so we order + grab the row at the 95th index
      // application-side. Cap per-day samples to avoid pathological
      // pulls.
      const dailyRaw = await execute(
        deps.db,
        `SELECT substr(ts, 1, 10) AS date,
                COUNT(*) AS requests,
                SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
                AVG(latency_ms) AS avg_latency_ms
           FROM api_requests
           WHERE api_key_id = ? AND ts >= ${sinceClause}
           GROUP BY date
           ORDER BY date ASC`,
        [apiKey.id],
      );

      const byDay: z.infer<typeof UsageDaySchema>[] = [];
      let totalReq = 0;
      let totalErr = 0;
      let totalLatency = 0;
      for (const row of dailyRaw.rows) {
        const date = String(row.date);
        const requests = Number(row.requests ?? 0);
        const errors = Number(row.errors ?? 0);
        const avgLatency = Number(row.avg_latency_ms ?? 0);
        const p95 = await computeP95(deps.db, apiKey.id, date);
        byDay.push({
          date,
          requests,
          errors,
          avg_latency_ms: round2(avgLatency),
          p95_latency_ms: round2(p95),
        });
        totalReq += requests;
        totalErr += errors;
        totalLatency += avgLatency * requests;
      }

      const byEndpointRaw = await execute(
        deps.db,
        `SELECT method, path,
                COUNT(*) AS requests,
                SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
           FROM api_requests
           WHERE api_key_id = ? AND ts >= ${sinceClause}
           GROUP BY method, path
           ORDER BY requests DESC
           LIMIT 50`,
        [apiKey.id],
      );

      return c.json(
        {
          network,
          api_key_id: apiKey.id,
          window_days: days,
          totals: {
            requests: totalReq,
            errors: totalErr,
            avg_latency_ms: totalReq > 0 ? round2(totalLatency / totalReq) : 0,
          },
          by_day: byDay,
          by_endpoint: byEndpointRaw.rows.map((r) => ({
            method: String(r.method),
            path: String(r.path),
            requests: Number(r.requests ?? 0),
            errors: Number(r.errors ?? 0),
          })),
        },
        200,
      );
    },
  );

  // GET /v1/metrics/events
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/metrics/events',
      tags: ['metrics'],
      summary: 'Event counters by phase + kind for the caller network.',
      request: {
        query: z.object({
          hours: z.coerce.number().int().min(1).max(168).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Event rollups in the requested window.',
          content: { 'application/json': { schema: EventCountsSchema } },
        },
      },
    }),
    async (c) => {
      const hours = c.req.valid('query').hours ?? 24;
      const network = c.var.network;
      const sinceClause = `datetime('now', '-${hours} hour')`;

      const phaseRows = await execute(
        deps.db,
        `SELECT phase, COUNT(*) AS n FROM events
           WHERE network = ? AND ts >= ${sinceClause}
           GROUP BY phase`,
        [network],
      );
      const kindRows = await execute(
        deps.db,
        `SELECT kind, COUNT(*) AS n FROM events
           WHERE network = ? AND ts >= ${sinceClause}
           GROUP BY kind`,
        [network],
      );

      const byPhase: Record<string, number> = {};
      let total = 0;
      let failed = 0;
      for (const r of phaseRows.rows) {
        const phase = String(r.phase);
        const n = Number(r.n ?? 0);
        byPhase[phase] = n;
        total += n;
        if (phase === 'failed') failed += n;
      }
      const byKind: Record<string, number> = {};
      for (const r of kindRows.rows) {
        byKind[String(r.kind)] = Number(r.n ?? 0);
      }
      const failureRate = total > 0 ? failed / total : 0;

      return c.json(
        {
          network,
          window_hours: hours,
          by_phase: byPhase,
          by_kind: byKind,
          failure_rate: round2(failureRate),
        },
        200,
      );
    },
  );

  return app;
}

async function computeP95(db: DbClient, apiKeyId: string, date: string): Promise<number> {
  const res = await execute(
    db,
    `SELECT latency_ms FROM api_requests
       WHERE api_key_id = ? AND substr(ts, 1, 10) = ?
       ORDER BY latency_ms ASC
       LIMIT 1000`,
    [apiKeyId, date],
  );
  const samples = res.rows.map((r) => Number(r.latency_ms ?? 0));
  if (samples.length === 0) return 0;
  const idx = Math.min(samples.length - 1, Math.floor(0.95 * samples.length));
  return samples[idx] ?? 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

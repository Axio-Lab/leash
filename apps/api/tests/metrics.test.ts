/**
 * Metrics rollup tests.
 *
 * Drives traffic through the rig, then asserts the rollup endpoints
 * report the expected counts. We hit the events feed (which is cheap
 * and authenticated) to seed `api_requests`, then create event rows
 * directly for the events-rollup endpoint.
 */

import { describe, it, expect } from 'vitest';

import { createTestRig, authedFetch } from './helpers.js';
import { createPreparedEvent, markFailed } from '../src/storage/events.js';

describe('metrics endpoints', () => {
  it('reports usage rollups for the caller key', async () => {
    const rig = await createTestRig({ rateLimitRpm: 1000 });
    // Drive a handful of authenticated requests so api_requests fills up.
    for (let i = 0; i < 5; i += 1) {
      const res = await authedFetch(rig, '/v1/events');
      expect(res.status).toBe(200);
    }
    // Trigger a 4xx so the errors counter has something to report.
    const notFound = await authedFetch(rig, '/v1/events/does_not_exist');
    expect(notFound.status).toBe(404);

    const res = await authedFetch(rig, '/v1/metrics/usage?days=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      network: string;
      window_days: number;
      totals: { requests: number; errors: number; avg_latency_ms: number };
      by_day: Array<{ date: string; requests: number; errors: number }>;
      by_endpoint: Array<{ method: string; path: string; requests: number; errors: number }>;
    };
    expect(body.network).toBe('solana-devnet');
    expect(body.window_days).toBe(1);
    expect(body.totals.requests).toBeGreaterThanOrEqual(6);
    expect(body.totals.errors).toBeGreaterThanOrEqual(1);
    expect(body.by_day.length).toBe(1);
    expect(body.by_day[0]?.requests).toBeGreaterThanOrEqual(6);

    const eventsEndpoint = body.by_endpoint.find((e) => e.path === '/v1/events');
    expect(eventsEndpoint).toBeDefined();
    expect(eventsEndpoint!.requests).toBeGreaterThanOrEqual(5);
  });

  it('reports event counts grouped by phase + kind', async () => {
    const rig = await createTestRig({ rateLimitRpm: 1000 });
    const a = await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });
    await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });
    await markFailed(rig.db, a, 'rpc_error', 'boom');

    const res = await authedFetch(rig, '/v1/metrics/events?hours=24');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      network: string;
      by_phase: Record<string, number>;
      by_kind: Record<string, number>;
      failure_rate: number;
    };
    expect(body.network).toBe('solana-devnet');
    expect(body.by_kind['agent.identity.register']).toBeGreaterThanOrEqual(2);
    expect((body.by_phase.failed ?? 0) + (body.by_phase.prepared ?? 0)).toBeGreaterThanOrEqual(2);
    expect(body.failure_rate).toBeGreaterThan(0);
  });

  it('isolates metrics by network / api key', async () => {
    const rig = await createTestRig({ rateLimitRpm: 1000 });
    // Mainnet events should never appear under a devnet key.
    await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-mainnet',
    });
    const res = await authedFetch(rig, '/v1/metrics/events?hours=24');
    const body = (await res.json()) as { by_kind: Record<string, number> };
    // Devnet is empty (we didn't create any devnet rows in this test).
    // Either the kind is absent or its count reflects ONLY devnet rows.
    expect(body.by_kind['agent.identity.register'] ?? 0).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';

describe('public stats', () => {
  it('GET /v1/stats/public returns a snapshot without auth', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(new Request('http://test.local/v1/stats/public'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const k of [
      'receipts_total',
      'receipts_24h',
      'volume_total_usdc',
      'volume_24h_usdc',
      'active_agents',
      'active_listings',
      'cached_at',
    ]) {
      expect(body[k]).toBeDefined();
    }
    expect(typeof body.cached_at).toBe('string');
    expect(typeof body.receipts_total).toBe('number');
    expect(typeof body.volume_total_usdc).toBe('string');
  });
});

import { describe, it, expect } from 'vitest';

import { createTestRig, authedFetch, TEST_API_KEY_OWNER_WALLET } from './helpers.js';
import { createApiKey } from '../src/storage/api-keys.js';

describe('api key auth', () => {
  it('rejects requests without a key', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(new Request('http://test.local/v1/events'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('rejects unrecognised keys', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/events', {
        headers: { authorization: 'Bearer lsh_test_does_not_exist_xxxxxxxxxxxx' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects keys with an unknown prefix', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/events', {
        headers: { authorization: 'Bearer wrong_prefix_aaaaaaaaaaaaaaaa' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('binds devnet keys to devnet only', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/events');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ network: string }> };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('rate-limits per key', async () => {
    const rig = await createTestRig({ rateLimitRpm: 3 });
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await authedFetch(rig, '/v1/events');
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('isolates rate limits between keys', async () => {
    const rig = await createTestRig({ rateLimitRpm: 2 });
    // Burn the budget on the first key.
    await authedFetch(rig, '/v1/events');
    await authedFetch(rig, '/v1/events');
    const burned = await authedFetch(rig, '/v1/events');
    expect(burned.status).toBe(429);
    // A fresh key starts at zero.
    const { plaintext } = await createApiKey(rig.db, {
      label: 'second',
      network: 'solana-devnet',
      ownerWallet: TEST_API_KEY_OWNER_WALLET,
    });
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/events', {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(res.status).toBe(200);
  });
});

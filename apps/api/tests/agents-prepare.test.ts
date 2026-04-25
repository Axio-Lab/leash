import { describe, it, expect } from 'vitest';

import { createTestRig, authedFetch } from './helpers.js';

const DUMMY_WALLET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Validation + lifecycle coverage for `POST /v1/agents/prepare`.
 *
 * The success path is exercised by `apps/api/scripts/e2e-devnet.ts`
 * because it requires a real call to the Metaplex Agents API. Here we
 * focus on the bits that don't need network: zod validation, network
 * binding from the API key, and the OpenAPI doc surface.
 */
describe('POST /v1/agents/prepare', () => {
  it('rejects missing required fields with 400/422', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/agents/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect([400, 422]).toContain(res.status);
  });

  it('rejects malformed wallet pubkey', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/agents/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet: 'not-a-pubkey',
        name: 'Demo Agent',
        uri: 'https://leash.market/test-agent.json',
        description: 'A test agent.',
      }),
    });
    expect([400, 422]).toContain(res.status);
  });

  it('rejects malformed metadata uri', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/agents/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet: DUMMY_WALLET,
        name: 'Demo Agent',
        uri: 'not-a-url',
        description: 'A test agent.',
      }),
    });
    expect([400, 422]).toContain(res.status);
  });

  it('appears in the OpenAPI doc under the agents tag', async () => {
    const rig = await createTestRig({ docsEnabled: true });
    const res = await rig.app.fetch(new Request('http://test.local/openapi.json'));
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { tags?: string[]; summary?: string }>>;
    };
    const op = doc.paths['/v1/agents/prepare']?.post;
    expect(op).toBeDefined();
    expect(op?.tags).toContain('agents');
    expect(op?.summary?.toLowerCase()).toContain('mint');
  });
});

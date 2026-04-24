import { describe, it, expect } from 'vitest';

import { createTestRig } from './helpers.js';

describe('health routes', () => {
  it('GET /v1/health returns ok=true without auth', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(new Request('http://test.local/v1/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ts: string };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('string');
  });

  it('GET /v1/version reports both networks', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(new Request('http://test.local/v1/version'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; networks: string[] };
    expect(body.networks).toContain('solana-devnet');
    expect(body.networks).toContain('solana-mainnet');
  });

  it('GET /openapi.json returns an OpenAPI 3.1 doc with key tags', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(new Request('http://test.local/openapi.json'));
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      tags: { name: string }[];
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toContain('Leash');
    const tagNames = doc.tags.map((t) => t.name);
    for (const expected of [
      'health',
      'agents',
      'identity',
      'executive',
      'delegation',
      'treasury',
      'token',
      'submit',
      'events',
    ]) {
      expect(tagNames).toContain(expected);
    }
  });
});

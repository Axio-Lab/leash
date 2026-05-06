import { describe, expect, it } from 'vitest';
import { createRunnerClient } from '../src/client/index.js';
import { createEndpointStore } from '../src/storage/endpoints.js';
import { createHttpServer } from '../src/http/server.js';
import { createMemoryStore } from '../src/storage/memory.js';
import { finalizeReceipt } from '@leashmarket/core';
import type { ReceiptV1 } from '@leashmarket/schemas';

const OWNER_AGENT = '11111111111111111111111111111111';

function buildHarness() {
  const endpoints = createEndpointStore();
  const receipts = createMemoryStore();
  const app = createHttpServer(receipts, { endpoints });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const reqInit: RequestInit = { ...(init ?? {}) };
    return app.request(url, reqInit);
  };
  return { client: createRunnerClient({ url: 'http://localhost', fetch: fetchImpl }) };
}

function makeReceipt(overrides: Partial<ReceiptV1> = {}): ReceiptV1 {
  return finalizeReceipt({
    v: '0.1',
    kind: 'earn',
    agent: OWNER_AGENT,
    nonce: 0,
    ts: '2026-04-22T00:00:00.000Z',
    policy_v: '0.1',
    request: { method: 'POST', url: 'https://example.com/x/abc', body_hash: null },
    decision: 'allow',
    reason: null,
    price: { amount: '1000', currency: 'USDC', network: 'solana-devnet' },
    facilitator: 'https://facilitator.svmacc.tech',
    tx_sig: 'abc',
    payment_requirements_hash: null,
    response: { status: 200, body_hash: null },
    prev_receipt_hash: null,
    ...overrides,
  });
}

describe('runner client', () => {
  it('creates and lists endpoints', async () => {
    const { client } = buildHarness();
    const created = await client.endpoints.create({
      label: 'Echo pro',
      owner_agent: OWNER_AGENT,
      method: 'POST',
      price: '$0.01',
      network: 'solana-devnet',
      response: { status: 200, mimeType: 'application/json', body: { ok: true } },
      wrap_receipt: false,
    });
    expect(created.v).toBe('0.1');
    expect(created.id).toMatch(/^[a-z0-9-]+$/);

    const list = await client.endpoints.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
  });

  it('returns null when fetching a missing endpoint', async () => {
    const { client } = buildHarness();
    const ep = await client.endpoints.get('does-not-exist');
    expect(ep).toBeNull();
  });

  it('deletes endpoints idempotently', async () => {
    const { client } = buildHarness();
    const created = await client.endpoints.create({
      id: 'del-me',
      label: 'X',
      owner_agent: OWNER_AGENT,
      method: 'POST',
      price: '$0.01',
      network: 'solana-devnet',
      response: { status: 200, mimeType: 'application/json', body: { ok: true } },
      wrap_receipt: false,
    });
    expect(created.id).toBe('del-me');
    const a = await client.endpoints.delete('del-me');
    const b = await client.endpoints.delete('del-me');
    expect(a).toBe(true);
    expect(b).toBe(false);
  });

  it('posts and lists receipts', async () => {
    const { client } = buildHarness();
    const r = makeReceipt();
    const hash = await client.receipts.post(r);
    expect(hash).toBe(r.receipt_hash);
    const list = await client.receipts.list(OWNER_AGENT);
    expect(list).toHaveLength(1);
    expect(list[0]?.receipt_hash).toBe(r.receipt_hash);
  });

  it('reports health', async () => {
    const { client } = buildHarness();
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.paused).toBe(false);
  });
});

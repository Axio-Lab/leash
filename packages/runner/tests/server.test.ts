import { describe, expect, it } from 'vitest';
import { finalizeReceipt } from '@leash/core';
import { appendLine, createMemoryStore, listLines } from '../src/storage/memory.js';
import { createHttpServer } from '../src/http/server.js';

const MINT = '11111111111111111111111111111111';

function sampleReceipt() {
  return finalizeReceipt({
    v: '0.1',
    kind: 'spend',
    agent: MINT,
    nonce: 0,
    ts: '2025-01-01T00:00:00.000Z',
    policy_v: '0.1',
    request: { method: 'POST', url: 'http://localhost/echo', body_hash: null },
    decision: 'allow',
    reason: null,
    price: { amount: '0.01', currency: 'USDC' },
    facilitator: 'local',
    tx_sig: null,
    response: { status: 200, body_hash: null },
    prev_receipt_hash: null,
  });
}

describe('runner http', () => {
  it('serves jsonl', async () => {
    const store = createMemoryStore();
    appendLine(store, 'mint1', '{"v":"0.1","nonce":0}');
    const app = createHttpServer(store);
    const res = await app.request('http://localhost/a/mint1/receipts.jsonl');
    expect(res.status).toBe(200);
    const t = await res.text();
    expect(t).toContain('nonce');
  });

  it('/pause reflects kill switch', async () => {
    const app = createHttpServer(createMemoryStore(), {
      resolvePause: async () => ({ paused: true, source: 'env' }),
    });
    const res = await app.request('http://localhost/pause');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paused: boolean; source: string };
    expect(body.paused).toBe(true);
    expect(body.source).toBe('env');
    const health = await app.request('http://localhost/health');
    const h = (await health.json()) as { ok: boolean; paused: boolean };
    expect(h.paused).toBe(true);
    expect(h.ok).toBe(false);
  });

  it('accepts a valid ReceiptV1 via POST and exposes it on the jsonl feed', async () => {
    const store = createMemoryStore();
    const app = createHttpServer(store);
    const receipt = sampleReceipt();

    const post = await app.request(`http://localhost/a/${MINT}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(receipt),
    });
    expect(post.status).toBe(200);
    const body = (await post.json()) as { ok: boolean; receipt_hash: string };
    expect(body.ok).toBe(true);
    expect(body.receipt_hash).toBe(receipt.receipt_hash);

    expect(listLines(store, MINT)).toHaveLength(1);

    const get = await app.request(`http://localhost/a/${MINT}/receipts.jsonl`);
    const text = await get.text();
    expect(text).toContain(receipt.receipt_hash);
  });

  it('rejects a receipt with invalid shape', async () => {
    const app = createHttpServer(createMemoryStore());
    const post = await app.request(`http://localhost/a/${MINT}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ not: 'a receipt' }),
    });
    expect(post.status).toBe(422);
  });

  it('rejects a receipt whose agent does not match the URL mint', async () => {
    const app = createHttpServer(createMemoryStore());
    const receipt = sampleReceipt(); // agent = MINT
    const otherMint = '22222222222222222222222222222222';
    const post = await app.request(`http://localhost/a/${otherMint}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(receipt),
    });
    expect(post.status).toBe(422);
  });

  it('forwards accepted receipts to the configured Leash API in the background', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchSpy = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };
    const app = createHttpServer(createMemoryStore(), {
      forward: { apiUrl: 'https://api.example.test', apiKey: 'lsh_test_dummy', fetch: fetchSpy },
    });
    const receipt = sampleReceipt();
    const post = await app.request(`http://localhost/a/${MINT}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(receipt),
    });
    expect(post.status).toBe(200);
    // The forward is fire-and-forget; give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.example.test/v1/receipts/${MINT}`);
    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get('authorization')).toBe('Bearer lsh_test_dummy');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('keeps returning 200 even when the forwarder errors', async () => {
    const fetchSpy = async () => {
      throw new Error('boom');
    };
    const app = createHttpServer(createMemoryStore(), {
      forward: { apiUrl: 'https://api.example.test', apiKey: 'lsh_test_dummy', fetch: fetchSpy },
    });
    const receipt = sampleReceipt();
    const post = await app.request(`http://localhost/a/${MINT}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(receipt),
    });
    expect(post.status).toBe(200);
  });
});

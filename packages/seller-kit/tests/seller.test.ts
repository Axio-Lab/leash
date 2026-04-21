import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { ReceiptV1Schema, type ReceiptV1 } from '@leash/schemas';
import { createSeller } from '../src/hono/create-seller.js';
import { parsePrice } from '../src/receipts/price.js';

const ASSET = '11111111111111111111111111111111';

function makeApp(extra?: { onReceipt?: (r: ReceiptV1) => void }) {
  const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
  const app = new Hono();
  createSeller(app, {
    umi,
    sellerAgent: { asset: ASSET },
    routes: { 'POST /tag': { price: '$0.001', description: 'tag' } },
    onReceipt: extra?.onReceipt,
  });
  app.post('/tag', (c) => c.json({ ok: true }));
  return app;
}

describe('createSeller — gate', () => {
  it('returns 402 without payment header', async () => {
    const res = await makeApp().request('http://localhost/tag', { method: 'POST' });
    expect(res.status).toBe(402);
  });

  it('returns 200 with x-payment header', async () => {
    const res = await makeApp().request('http://localhost/tag', {
      method: 'POST',
      headers: { 'x-payment': 'mock' },
    });
    expect(res.status).toBe(200);
  });
});

describe('createSeller — earn receipts', () => {
  it('emits a valid earn ReceiptV1 on a paid call', async () => {
    const sink: ReceiptV1[] = [];
    const app = makeApp({ onReceipt: (r) => void sink.push(r) });

    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'x-payment': 'mock', 'x-tx-sig': 'abc123', 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(res.status).toBe(200);
    expect(sink).toHaveLength(1);

    const r = sink[0];
    expect(ReceiptV1Schema.parse(r)).toEqual(r);
    expect(r.kind).toBe('earn');
    expect(r.agent).toBe(ASSET);
    expect(r.decision).toBe('allow');
    expect(r.price).toEqual({ amount: '0.001', currency: 'USDC' });
    expect(r.tx_sig).toBe('abc123'); // forwarded from x-tx-sig header
    expect(r.request.method).toBe('POST');
    expect(r.request.body_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.response?.status).toBe(200);
    expect(r.receipt_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.prev_receipt_hash).toBeNull();
  });

  it('does NOT emit on a 402 (no settled trade)', async () => {
    const sink: ReceiptV1[] = [];
    const res = await makeApp({ onReceipt: (r) => void sink.push(r) }).request(
      'http://localhost/tag',
      { method: 'POST' },
    );
    expect(res.status).toBe(402);
    expect(sink).toHaveLength(0);
  });

  it('chains receipts: nonce increments and prev_receipt_hash links', async () => {
    const sink: ReceiptV1[] = [];
    const app = makeApp({ onReceipt: (r) => void sink.push(r) });

    for (let i = 0; i < 3; i++) {
      const res = await app.request('http://localhost/tag', {
        method: 'POST',
        headers: { 'x-payment': 'mock' },
        body: JSON.stringify({ i }),
      });
      expect(res.status).toBe(200);
    }

    expect(sink.map((r) => r.nonce)).toEqual([0, 1, 2]);
    expect(sink[0].prev_receipt_hash).toBeNull();
    expect(sink[1].prev_receipt_hash).toBe(sink[0].receipt_hash);
    expect(sink[2].prev_receipt_hash).toBe(sink[1].receipt_hash);
  });

  it('does NOT emit on a 5xx handler failure (the trade is bogus)', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    const sink: ReceiptV1[] = [];
    createSeller(app, {
      umi,
      sellerAgent: { asset: ASSET },
      routes: { 'POST /boom': { price: '$0.001', description: 'boom' } },
      onReceipt: (r) => void sink.push(r),
    });
    app.post('/boom', (c) => c.json({ error: 'kaboom' }, 500));

    const res = await app.request('http://localhost/boom', {
      method: 'POST',
      headers: { 'x-payment': 'mock' },
    });
    expect(res.status).toBe(500);
    expect(sink).toHaveLength(0);
  });

  it('swallows onReceipt errors so paying customers still get a 200', async () => {
    const app = makeApp({
      onReceipt: () => {
        throw new Error('runner is on fire');
      },
    });
    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'x-payment': 'mock' },
    });
    expect(res.status).toBe(200);
  });
});

describe('parsePrice', () => {
  it('parses dollar shorthand as USDC', () => {
    expect(parsePrice('$0.001')).toEqual({ amount: '0.001', currency: 'USDC' });
    expect(parsePrice('$ 1.5')).toEqual({ amount: '1.5', currency: 'USDC' });
  });
  it('parses suffixed currency', () => {
    expect(parsePrice('0.01 USDC')).toEqual({ amount: '0.01', currency: 'USDC' });
    expect(parsePrice('5USDT')).toEqual({ amount: '5', currency: 'USDT' });
    expect(parsePrice('1 USD')).toEqual({ amount: '1', currency: 'USDC' });
  });
  it('treats bare numbers as USDC', () => {
    expect(parsePrice('0.5')).toEqual({ amount: '0.5', currency: 'USDC' });
  });
  it('returns null for garbage', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('free')).toBeNull();
    expect(parsePrice('$')).toBeNull();
  });
});

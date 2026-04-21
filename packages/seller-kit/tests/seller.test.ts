import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createSeller } from '../src/hono/create-seller.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';

describe('createSeller', () => {
  it('returns 402 without payment header', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    createSeller(app, {
      umi,
      sellerAgent: { asset: '11111111111111111111111111111111' },
      routes: { 'POST /tag': { price: '$0.001', description: 'tag' } },
    });
    app.post('/tag', (c) => c.json({ ok: true }));
    const res = await app.request('http://localhost/tag', { method: 'POST' });
    expect(res.status).toBe(402);
  });
  it('returns 200 with x-payment header', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    createSeller(app, {
      umi,
      sellerAgent: { asset: '11111111111111111111111111111111' },
      routes: { 'POST /tag': { price: '$0.001', description: 'tag' } },
    });
    app.post('/tag', (c) => c.json({ ok: true }));
    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'x-payment': 'mock' },
    });
    expect(res.status).toBe(200);
  });
});

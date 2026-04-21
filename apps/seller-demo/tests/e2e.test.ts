import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';

describe('seller-demo shape', () => {
  it('402 then 200', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    createSeller(app, {
      umi,
      sellerAgent: { asset: '11111111111111111111111111111111' },
      routes: { 'POST /tag': { price: '$0.001', description: 'x' } },
    });
    app.post('/tag', (c) => c.json({ ok: 1 }));
    expect((await app.request('http://x/tag', { method: 'POST' })).status).toBe(402);
    expect(
      (await app.request('http://x/tag', { method: 'POST', headers: { 'x-payment': '1' } })).status,
    ).toBe(200);
  });
});

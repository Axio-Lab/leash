import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';
import { stubFacilitator } from '@leash/seller-kit/test-utils';

describe('seller-demo shape', () => {
  it('returns 402 + a base64 PAYMENT-REQUIRED header on an unpaid request', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    createSeller(app, {
      umi,
      sellerAgent: { asset: '11111111111111111111111111111111' },
      routes: { 'POST /tag': { price: '$0.001', description: 'x' } },
      facilitator: stubFacilitator(),
    });
    app.post('/tag', (c) => c.json({ ok: 1 }));

    const res = await app.request('http://x/tag', { method: 'POST' });
    expect(res.status).toBe(402);
    const required = res.headers.get('PAYMENT-REQUIRED');
    expect(required).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(required ?? '', 'base64').toString('utf8')) as {
      accepts?: { network: string; scheme: string; payTo: string }[];
    };
    expect(decoded.accepts?.[0]?.scheme).toBe('exact');
    expect(decoded.accepts?.[0]?.network).toMatch(/^solana:/);
    expect(decoded.accepts?.[0]?.payTo).toBeTruthy();
  });
});

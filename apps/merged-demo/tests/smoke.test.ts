import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';
import { createBuyer } from '@leash/buyer-kit';
import type { ReceiptV1, RulesV1 } from '@leash/schemas';
import { ReceiptV1Schema } from '@leash/schemas';

const AGENT = '11111111111111111111111111111111';

const RULES: RulesV1 = {
  v: '0.1',
  budget: { daily: '100', perCall: '0.01', currency: 'USDC' },
  hosts: { allow: ['localhost', '127.0.0.1'] },
  triggers: [{ type: 'interval', seconds: 30 }],
};

describe('merged-demo: in-process buyer ↔ seller ↔ receipt store', () => {
  it('runs the x402 round-trip and produces a valid spend receipt', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    createSeller(app, {
      umi,
      sellerAgent: { asset: AGENT },
      routes: { 'POST /echo': { price: '$0.001', description: 'echo' } },
    });
    app.post('/echo', (c) => c.json({ echo: true }));

    // Bridge `globalThis.fetch` calls to the in-memory Hono app so the buyer
    // talks to the seller without a real socket. This mirrors what happens
    // inside `merged-demo` when both run in the same process.
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return app.request(url, init);
    }) as typeof fetch;

    const receipts: ReceiptV1[] = [];

    try {
      const buyer = createBuyer({
        agent: AGENT,
        rules: RULES,
        onReceipt: (r) => void receipts.push(r),
      });

      const { response, receipt } = await buyer.fetch('http://localhost/echo', { method: 'POST' });

      expect(response.status).toBe(200);
      expect(receipts).toHaveLength(1);

      // Receipt is a valid ReceiptV1 and links back to the same agent.
      expect(ReceiptV1Schema.parse(receipt)).toEqual(receipt);
      expect(receipt.agent).toBe(AGENT);
      expect(receipt.decision).toBe('allow');
      expect(receipt.kind).toBe('spend');
      expect(receipt.request.url).toBe('http://localhost/echo');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

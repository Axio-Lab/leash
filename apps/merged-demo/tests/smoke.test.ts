import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leashmarket/seller-kit';
import { stubFacilitator } from '@leashmarket/seller-kit/test-utils';
import { createBuyer } from '@leashmarket/buyer-kit';
import type { ClientSvmSigner, LeashFetch } from '@leashmarket/core';
import type { ReceiptAny, RulesV1 } from '@leashmarket/schemas';
import { ReceiptV1Schema } from '@leashmarket/schemas';

const AGENT = '11111111111111111111111111111111';

const RULES: RulesV1 = {
  v: '0.1',
  budget: { daily: '100', perCall: '0.01', currency: 'USDC' },
  hosts: { allow: ['localhost', '127.0.0.1'] },
  triggers: [{ type: 'interval', seconds: 30 }],
};

const STUB_SIGNER = {} as ClientSvmSigner;

describe('merged-demo: in-process buyer ↔ seller ↔ receipt store', () => {
  it('seller returns 402 + PAYMENT-REQUIRED header on an unpaid request', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    createSeller(app, {
      umi,
      sellerAgent: { asset: AGENT },
      routes: { 'POST /echo': { price: '$0.001', description: 'echo' } },
      facilitator: stubFacilitator(),
    });
    app.post('/echo', (c) => c.json({ echo: true }));

    const res = await app.request('http://localhost/echo', { method: 'POST' });
    expect(res.status).toBe(402);
    const required = res.headers.get('PAYMENT-REQUIRED');
    expect(required).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(required ?? '', 'base64').toString('utf8')) as {
      accepts?: { network: string; scheme: string }[];
    };
    expect(decoded.accepts?.[0]?.scheme).toBe('exact');
    expect(decoded.accepts?.[0]?.network).toMatch(/^solana:/);
  });

  it('buyer policy gate emits a valid spend receipt on a 200 (with stubbed fetch)', async () => {
    const sink: ReceiptAny[] = [];
    const stubFetch: LeashFetch = async () =>
      new Response(JSON.stringify({ paid: true }), { status: 200 });
    const buyer = createBuyer({
      agent: AGENT,
      rules: RULES,
      signer: STUB_SIGNER,
      fetch: stubFetch,
      onReceipt: (r) => void sink.push(r),
    });

    const { response, receipt } = await buyer.fetch('http://localhost/echo', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(ReceiptV1Schema.parse(receipt)).toEqual(receipt);
    expect(receipt.agent).toBe(AGENT);
    expect(receipt.decision).toBe('allow');
    expect(receipt.kind).toBe('spend');
    expect(sink).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { ReceiptV1Schema, type ReceiptV1 } from '@leash/schemas';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';
import { SOLANA_DEVNET_CAIP2 } from '@x402/svm';
import { createSeller } from '../src/hono/create-seller.js';
import { parsePrice } from '../src/receipts/price.js';

const ASSET = '11111111111111111111111111111111';
const FACILITATOR_FEEPAYER = 'FaciliTatoR1111111111111111111111111111111';

/**
 * Stub facilitator that approves every request and returns a deterministic
 * Solana signature. Lets us exercise the real `@x402/hono` middleware
 * without touching network or chain.
 */
function stubFacilitator(opts?: { txSig?: string }): FacilitatorClient {
  let nonce = 0;
  return {
    async getSupported(): Promise<SupportedResponse> {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: SOLANA_DEVNET_CAIP2,
            extra: { feePayer: FACILITATOR_FEEPAYER },
          },
        ],
        extensions: [],
        signers: {},
      };
    },
    async verify(
      _payload: PaymentPayload,
      _requirements: PaymentRequirements,
    ): Promise<VerifyResponse> {
      return { isValid: true, payer: 'Buyer1111111111111111111111111111111111' };
    },
    async settle(
      _payload: PaymentPayload,
      requirements: PaymentRequirements,
    ): Promise<SettleResponse> {
      nonce += 1;
      return {
        success: true,
        transaction: `${opts?.txSig ?? 'sig'}-${nonce}`,
        network: requirements.network,
        payer: 'Buyer1111111111111111111111111111111111',
      };
    },
  };
}

/**
 * Probe the seller for its `accepts[]` (the body is empty, but the
 * 402 response carries a base64-encoded `PAYMENT-REQUIRED` header), then
 * build a v2 PaymentPayload whose `accepted` matches one entry exactly so
 * the middleware's `findMatchingRequirements` (deepEqual) succeeds.
 */
async function buildPaidHeader(app: Hono, route: string): Promise<string> {
  const [method, path] = route.split(/\s+/, 2);
  const probe = await app.request(`http://localhost${path}`, { method: method.toUpperCase() });
  expect(probe.status).toBe(402);
  const required = probe.headers.get('PAYMENT-REQUIRED');
  if (!required) throw new Error('seller did not return PAYMENT-REQUIRED header');
  const decoded = JSON.parse(Buffer.from(required, 'base64').toString('utf8')) as {
    accepts: PaymentRequirements[];
  };
  const accepted = decoded.accepts[0];
  const payload = {
    x402Version: 2,
    accepted,
    payload: { transaction: 'AAAA' },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function makeApp(extra?: { onReceipt?: (r: ReceiptV1) => void; route?: string }) {
  const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
  const app = new Hono();
  const route = extra?.route ?? 'POST /tag';
  createSeller(app, {
    umi,
    sellerAgent: { asset: ASSET },
    routes: { [route]: { price: '$0.001', description: 'tag' } },
    onReceipt: extra?.onReceipt,
    facilitator: stubFacilitator(),
    network: 'solana-devnet',
  });
  const [, path] = route.split(/\s+/, 2);
  app.post(path, (c) => c.json({ ok: true }));
  return app;
}

describe('createSeller — gate', () => {
  it('returns 402 without payment header', async () => {
    const res = await makeApp().request('http://localhost/tag', { method: 'POST' });
    expect(res.status).toBe(402);
  });

  it('returns 200 with a payment header that the facilitator accepts', async () => {
    const app = makeApp();
    const header = await buildPaidHeader(app, 'POST /tag');
    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': header },
    });
    expect(res.status).toBe(200);
  });
});

describe('createSeller — earn receipts', () => {
  it('emits a valid earn ReceiptV1 with a real tx_sig on a settled call', async () => {
    const sink: ReceiptV1[] = [];
    const app = makeApp({ onReceipt: (r) => void sink.push(r) });
    const header = await buildPaidHeader(app, 'POST /tag');
    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': header, 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(res.status).toBe(200);
    expect(sink).toHaveLength(1);

    const r = sink[0];
    expect(ReceiptV1Schema.parse(r)).toEqual(r);
    expect(r.kind).toBe('earn');
    expect(r.agent).toBe(ASSET);
    expect(r.decision).toBe('allow');
    expect(r.price?.currency).toBe('USDC');
    // Receipts now stamp the friendly Leash slug (`solana-devnet`) instead
    // of the raw CAIP-2 chain id so explorers don't have to render
    // `solana:<genesis>` blobs. The wire-level paymentRequirements still
    // use the CAIP-2 form (verified by other tests in this file).
    expect(r.price?.network).toBe('solana-devnet');
    expect(r.tx_sig).toMatch(/^sig-/);
    expect(r.facilitator).not.toBeNull();
    expect(r.payment_requirements_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.request.method).toBe('POST');
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
    const header = await buildPaidHeader(app, 'POST /tag');

    for (let i = 0; i < 3; i++) {
      const res = await app.request('http://localhost/tag', {
        method: 'POST',
        headers: { 'PAYMENT-SIGNATURE': header },
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
      facilitator: stubFacilitator(),
      network: 'solana-devnet',
    });
    app.post('/boom', (c) => c.json({ error: 'kaboom' }, 500));
    const header = await buildPaidHeader(app, 'POST /boom');

    const res = await app.request('http://localhost/boom', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': header },
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
    const header = await buildPaidHeader(app, 'POST /tag');
    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': header },
    });
    expect(res.status).toBe(200);
  });
});

describe('parsePrice', () => {
  // Devnet USDC mint — must match `@leash/core/tokens` so format helpers
  // can reverse-resolve decimals correctly.
  const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const USDT_DEVNET = 'EcFc2cMyZxaKBkFK1XooxiyDyCPneLXiMwSJiVY6eTad';
  const USDG_DEVNET = '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7';

  it('parses dollar shorthand as USDC and returns atomic units', () => {
    expect(parsePrice('$0.001')).toEqual({
      amount: '1000',
      currency: 'USDC',
      asset: USDC_DEVNET,
    });
    expect(parsePrice('$1')).toEqual({
      amount: '1000000',
      currency: 'USDC',
      asset: USDC_DEVNET,
    });
    expect(parsePrice('$ 1.5')).toEqual({
      amount: '1500000',
      currency: 'USDC',
      asset: USDC_DEVNET,
    });
  });
  it('parses suffixed currency', () => {
    expect(parsePrice('0.01 USDC')).toEqual({
      amount: '10000',
      currency: 'USDC',
      asset: USDC_DEVNET,
    });
    expect(parsePrice('5USDT')).toEqual({
      amount: '5000000',
      currency: 'USDT',
      asset: USDT_DEVNET,
    });
    expect(parsePrice('1 USD')).toEqual({
      amount: '1000000',
      currency: 'USDC',
      asset: USDC_DEVNET,
    });
  });
  it('honours an explicit defaultCurrency', () => {
    expect(parsePrice('$1', { defaultCurrency: 'USDG' })).toEqual({
      amount: '1000000',
      currency: 'USDG',
      asset: USDG_DEVNET,
    });
  });
  it('treats bare numbers as the default currency', () => {
    expect(parsePrice('0.5')).toEqual({
      amount: '500000',
      currency: 'USDC',
      asset: USDC_DEVNET,
    });
  });
  it('returns null for garbage', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('free')).toBeNull();
    expect(parsePrice('$')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { ReceiptV1Schema, type ReceiptV1 } from '@leashmarket/schemas';
import type { PaymentRequirements } from '@x402/core/types';
import { SOLANA_DEVNET_CAIP2 } from '@x402/svm';
import { createSeller } from '../src/hono/create-seller.js';
import { parsePrice } from '../src/receipts/price.js';
import { stubFacilitator } from '../src/test-utils/stub-facilitator.js';

const ASSET = '11111111111111111111111111111111';

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

describe('createSeller — protocol fee', () => {
  // The seller is the source of truth for "what does the buyer owe?".
  // It MUST stamp `extra['leash.fee']` so that:
  //   1. The buyer's payment scheme can append the fee TransferChecked.
  //   2. The facilitator can verify both legs.
  //   3. The buyer's pre-flight quote can render the gross.
  it("stamps extra['leash.fee'] on every accepts[] entry in the 402 challenge", async () => {
    const app = makeApp();
    const probe = await app.request('http://localhost/tag', { method: 'POST' });
    expect(probe.status).toBe(402);
    const required = probe.headers.get('PAYMENT-REQUIRED');
    expect(required).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(required!, 'base64').toString('utf8')) as {
      accepts: Array<PaymentRequirements & { extra?: Record<string, unknown> }>;
    };
    expect(decoded.accepts.length).toBeGreaterThan(0);
    const entry = decoded.accepts[0]!;
    const fee = (entry.extra ?? {})['leash.fee'] as
      | { v?: string; bps?: number; feeAuthority?: string }
      | undefined;
    expect(fee).toBeDefined();
    expect(fee?.v).toBe('1');
    expect(fee?.bps).toBe(100);
    expect(fee?.feeAuthority).toBe('3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W');
  });

  it('enriches earn receipts with fee / gross / feeBps / feeAuthority on settled calls', async () => {
    const sink: ReceiptV1[] = [];
    const app = makeApp({ onReceipt: (r) => void sink.push(r) });
    const header = await buildPaidHeader(app, 'POST /tag');
    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': header },
    });
    expect(res.status).toBe(200);
    expect(sink).toHaveLength(1);
    const r = sink[0]!;
    // `$0.001` = 1000 atoms (USDC). 1% gross-up = +10 (ceil) = gross 1010.
    expect(r.price?.amount).toBe('1000');
    expect(r.price?.fee).toBe('10');
    expect(r.price?.gross).toBe('1010');
    expect(r.price?.feeBps).toBe(100);
    expect(r.price?.feeAuthority).toBe('3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W');
    // Round-trip through the schema so we catch any drift between
    // the receipt finalizer and the wire schema.
    expect(ReceiptV1Schema.parse(r)).toEqual(r);
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

describe('createSeller — PAYMENT-RESPONSE header', () => {
  /**
   * Regression: the upstream `@x402/hono` middleware encodes only
   * `{ success, transaction, payer, network, … }` into PAYMENT-RESPONSE
   * — it does NOT include the matched `paymentRequirements`. That left
   * `@leashmarket/buyer-kit`'s `parseSettlement` unable to recover the price
   * for a successful settlement, so spend receipts were stamped with
   * `price: null` even when the trade went through.
   *
   * Our `onAfterSettle` mutates `result` to attach `paymentRequirements`
   * (both at the top level and under `extensions['leash.paymentRequirements']`)
   * so the encoded header round-trips the requirements to any buyer.
   */
  it('round-trips paymentRequirements so buyers can stamp price on spend receipts', async () => {
    const app = makeApp();
    const header = await buildPaidHeader(app, 'POST /tag');
    const res = await app.request('http://localhost/tag', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': header },
    });
    expect(res.status).toBe(200);
    const encoded = res.headers.get('PAYMENT-RESPONSE');
    expect(encoded, 'seller did not emit PAYMENT-RESPONSE header').not.toBeNull();
    const decoded = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8')) as {
      transaction?: string;
      paymentRequirements?: PaymentRequirements;
      extensions?: Record<string, unknown>;
    };
    expect(decoded.transaction).toMatch(/^sig-/);
    // Top-level field — what existing buyer-kit `parseSettlement` reads.
    // `asset` is the resolved USDC devnet mint (not our seller's agent
    // ASSET), because `$0.001` is parsed against the USDC token registry.
    expect(decoded.paymentRequirements).toBeTruthy();
    expect(decoded.paymentRequirements?.asset).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(decoded.paymentRequirements?.amount).toBe('1000');
    expect(decoded.paymentRequirements?.network).toBe(SOLANA_DEVNET_CAIP2);
    // Namespaced extension surface — for future buyers that prefer it.
    expect(decoded.extensions).toBeTruthy();
    expect(decoded.extensions?.['leash.paymentRequirements']).toEqual(decoded.paymentRequirements);
  });
});

describe('parsePrice', () => {
  // Devnet USDC mint — must match `@leashmarket/core/tokens` so format helpers
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

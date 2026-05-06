import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  buildMppAuthorizationHeader,
  MPP_PROBLEM_TYPE,
  type MppCredentialV1,
} from '@leashmarket/core';
import { isReceiptV02, ReceiptV02MppSchema, type ReceiptV02Mpp } from '@leashmarket/schemas';
import { createMppSeller, type MppFacilitatorClient } from '../src/mpp/index.js';

const ASSET = '11111111111111111111111111111111';
const FEE_PAYER = 'FYB56sVBW2r4Ka7W9kdJWTPY9FKQLxbT6h4Ysr6aLPZD';

function mockFacilitatorOk(): MppFacilitatorClient {
  return {
    url: 'https://mpp-facilitator.test',
    async settle() {
      return { success: true, transaction: 'MPP_TX_SIG', slot: 42 };
    },
  };
}

describe('createMppSeller', () => {
  it('returns 402 with application/problem+json when no credential', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    createMppSeller(app, {
      umi,
      sellerAgent: { asset: ASSET },
      routes: { 'POST /mpp': { price: '$0.001', description: 'mpp route' } },
      feePayerAddress: FEE_PAYER,
      facilitator: mockFacilitatorOk(),
      network: 'solana-devnet',
    });
    app.post('/mpp', (c) => c.json({ ok: true }));

    const res = await app.request('http://localhost/mpp', { method: 'POST' });
    expect(res.status).toBe(402);
    expect(res.headers.get('content-type')).toMatch(/application\/problem\+json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe(MPP_PROBLEM_TYPE);
    expect(typeof body.challengeId).toBe('string');
    const req = body.request as Record<string, unknown>;
    expect(req.network).toBe('solana-devnet');
    expect(req.recipient).toBeTruthy();
    expect(req.feePayer).toBe(FEE_PAYER);
    expect(req.currency).toBe('USDC');
  });

  it('settles via facilitator, runs handler, stamps x-payment-receipt, emits v0.2 mpp earn receipt', async () => {
    const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
    const app = new Hono();
    const seen: ReceiptV02Mpp[] = [];
    createMppSeller(app, {
      umi,
      sellerAgent: { asset: ASSET },
      routes: { 'POST /mpp': { price: '$0.001', description: 'mpp route' } },
      feePayerAddress: FEE_PAYER,
      facilitator: mockFacilitatorOk(),
      network: 'solana-devnet',
      onReceipt: (r) => void seen.push(r),
    });
    app.post('/mpp', (c) => c.json({ ok: true }));

    const probe = await app.request('http://localhost/mpp', { method: 'POST' });
    expect(probe.status).toBe(402);
    const ch = (await probe.json()) as { challengeId: string };

    const credential: MppCredentialV1 = {
      v: '1',
      challengeId: ch.challengeId,
      signedTx: 'BASE64_TX',
    };
    const res = await app.request('http://localhost/mpp', {
      method: 'POST',
      headers: { authorization: buildMppAuthorizationHeader(credential) },
    });
    expect(res.status).toBe(200);
    const receiptB64 = res.headers.get('x-payment-receipt');
    expect(receiptB64).toBeTruthy();
    const settled = JSON.parse(Buffer.from(receiptB64!, 'base64').toString('utf8')) as {
      tx: string;
      slot: number;
    };
    expect(settled.tx).toBe('MPP_TX_SIG');
    expect(settled.slot).toBe(42);

    expect(seen).toHaveLength(1);
    const er = seen[0]!;
    expect(isReceiptV02(er)).toBe(true);
    expect(ReceiptV02MppSchema.parse(er).mpp_settlement_tx).toBe('MPP_TX_SIG');
    expect(er.kind).toBe('earn');
  });
});

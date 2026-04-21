import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBuyer } from '../src/create-buyer.js';
import type { LeashFetch } from '@leash/core';
import type { ClientSvmSigner } from '@leash/core';

afterEach(() => {
  vi.restoreAllMocks();
});

const rules = {
  v: '0.1' as const,
  budget: { daily: '10', perCall: '0.01', currency: 'USDC' as const },
  hosts: { allow: ['localhost', 'merchant.test'] },
  triggers: [],
};

const stubSigner = {} as ClientSvmSigner;

describe('createBuyer', () => {
  it('emits an allow receipt and ships it via onReceipt on a 200 response', async () => {
    const stubFetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const seen: unknown[] = [];
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
      onReceipt: (r) => {
        seen.push(r);
      },
    });
    const { response, receipt } = await buyer.fetch('http://merchant.test/tag', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(receipt.decision).toBe('allow');
    expect(receipt.facilitator).toBe('https://facilitator.svmacc.tech');
    expect(seen).toHaveLength(1);
  });

  it('records the seller-quoted price and failure reason on a 402 with no PAYMENT-RESPONSE', async () => {
    // Realistic shape of what `@x402/hono` returns on a failed settlement: a
    // 402 with the demanded `accepts[]` and a JSON body explaining why.
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'http://merchant.test/tag', description: 'Premium' },
      accepts: [
        {
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          amount: '5000000',
          asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
          maxTimeoutSeconds: 300,
          extra: { feePayer: 'FYB56sVBW2r4Ka7W9kdJWTPY9FKQLxbT6h4Ysr6aLPZD' },
        },
      ],
    };
    const headerB64 = Buffer.from(JSON.stringify(paymentRequired), 'utf8').toString('base64');
    const stubFetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient_funds' }), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'payment-required': headerB64,
        },
      }),
    );
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.response.status).toBe(402);
    expect(result.receipt.tx_sig).toBeNull();
    // Truth-recording: the receipt must reflect what the seller demanded, not
    // the buyer's policy ceiling.
    expect(result.receipt.price).toEqual({
      amount: '5000000',
      currency: 'USDC',
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    });
    // Body error wins over header error because it's typically the more
    // specific facilitator-side message.
    expect(result.receipt.reason).toBe('insufficient_funds');
    expect(result.failureReason).toBe('insufficient_funds');
    expect(result.quotedPrice?.amount).toBe('5000000');
    // Hash should be set so the receipt cryptographically pins which offer
    // the buyer attempted to settle, even though no tx_sig exists.
    expect(result.receipt.payment_requirements_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('emits a deny receipt without calling fetch when the host is denied', async () => {
    const stubFetch = vi.fn() as unknown as LeashFetch;
    const buyer = createBuyer({
      agent: 'A1',
      rules: { ...rules, hosts: { deny: ['merchant.test'] } },
      signer: stubSigner,
      fetch: stubFetch,
    });
    const { response, receipt } = await buyer.fetch('http://merchant.test/tag');
    expect(response.status).toBe(403);
    expect(receipt.decision).toBe('deny');
    expect(stubFetch).not.toHaveBeenCalled();
  });
});

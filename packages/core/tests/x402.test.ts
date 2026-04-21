import { describe, expect, it, vi } from 'vitest';
import { x402Fetch } from '../src/x402/client.js';

describe('x402Fetch', () => {
  it('retries on 402 with payment header', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ err: 'pay' }), { status: 402 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'x-tx-sig': 'abc' },
        }),
      );
    vi.stubGlobal('fetch', f);
    const res = await x402Fetch(
      'https://x.test/p',
      { method: 'GET' },
      {
        onPaymentRequired: async () => ({ 'x-payment': 'mock' }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.txSig).toBe('abc');
    expect(f).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

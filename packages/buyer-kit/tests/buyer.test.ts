import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBuyer } from '../src/create-buyer.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const rules = {
  v: '0.1' as const,
  budget: { daily: '10', perCall: '0.01', currency: 'USDC' as const },
  hosts: { allow: ['localhost'] },
  triggers: [],
};

describe('createBuyer', () => {
  it('pays with x-payment retry', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const buyer = createBuyer({ agent: 'A1', rules });
    const { response, receipt } = await buyer.fetch('http://localhost/tag', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(receipt.decision).toBe('allow');
    expect(f).toHaveBeenCalledTimes(2);
  });
});

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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuyer } from '@leash/buyer-kit';
import type { ClientSvmSigner, LeashFetch } from '@leash/core';
import { ReceiptV1Schema, type RulesV1 } from '@leash/schemas';

const RULES: RulesV1 = {
  v: '0.1',
  budget: { daily: '100', perCall: '0.01', currency: 'USDC' },
  hosts: { allow: ['localhost', '127.0.0.1'] },
  triggers: [{ type: 'interval', seconds: 30 }],
};

const AGENT = '11111111111111111111111111111111';
const STUB_SIGNER = {} as ClientSvmSigner;

/**
 * These smoke tests exercise the policy-gate + receipt emission paths in
 * `createBuyer`. The real x402 SPL transfer flow is covered by the
 * integration suite (`packages/seller-kit/tests`) — here we stub `cfg.fetch`
 * so we never touch the wallet, RPC, or facilitator.
 */
describe('buyer-demo / @leash/buyer-kit', () => {
  beforeEach(() => {
    /* nothing — we inject `fetch` per test */
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a valid ReceiptV1 on a successful spend (200 path)', async () => {
    const sink: unknown[] = [];
    const stubFetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const buyer = createBuyer({
      agent: AGENT,
      rules: RULES,
      signer: STUB_SIGNER,
      fetch: stubFetch,
      onReceipt: (r) => void sink.push(r),
    });

    const { response, receipt } = await buyer.fetch('http://localhost/echo', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);

    expect(ReceiptV1Schema.parse(receipt)).toEqual(receipt);
    expect(receipt.kind).toBe('spend');
    expect(receipt.decision).toBe('allow');
    expect(receipt.agent).toBe(AGENT);
    expect(receipt.policy_v).toBe(RULES.v);
    expect(receipt.receipt_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(sink).toHaveLength(1);
    expect((sink[0] as typeof receipt).receipt_hash).toBe(receipt.receipt_hash);
  });

  it('denies on disallowed host and emits a deny receipt', async () => {
    const sink: unknown[] = [];
    const stubFetch = vi.fn() as unknown as LeashFetch;
    const buyer = createBuyer({
      agent: AGENT,
      rules: RULES,
      signer: STUB_SIGNER,
      fetch: stubFetch,
      onReceipt: (r) => void sink.push(r),
    });

    const { response, receipt } = await buyer.fetch('http://evil.example/echo', { method: 'POST' });

    expect(response.status).toBe(403);
    expect(stubFetch).not.toHaveBeenCalled();
    expect(receipt.decision).toBe('deny');
    expect(sink).toHaveLength(1);
  });
});

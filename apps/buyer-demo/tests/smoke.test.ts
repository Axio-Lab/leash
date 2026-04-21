import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuyer } from '@leash/buyer-kit';
import { ReceiptV1Schema, type RulesV1 } from '@leash/schemas';

const RULES: RulesV1 = {
  v: '0.1',
  budget: { daily: '100', perCall: '0.01', currency: 'USDC' },
  hosts: { allow: ['localhost', '127.0.0.1'] },
  triggers: [{ type: 'interval', seconds: 30 }],
};

const AGENT = '11111111111111111111111111111111';

describe('buyer-demo / @leash/buyer-kit', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a valid ReceiptV1 on a successful spend (200 path)', async () => {
    const sink: unknown[] = [];
    const buyer = createBuyer({ agent: AGENT, rules: RULES, onReceipt: (r) => void sink.push(r) });

    const { response, receipt } = await buyer.fetch('http://localhost/echo', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(ReceiptV1Schema.parse(receipt)).toEqual(receipt);
    expect(receipt.kind).toBe('spend');
    expect(receipt.decision).toBe('allow');
    expect(receipt.agent).toBe(AGENT);
    expect(receipt.policy_v).toBe(RULES.v);
    expect(receipt.receipt_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(sink).toHaveLength(1);
    expect((sink[0] as typeof receipt).receipt_hash).toBe(receipt.receipt_hash);
  });

  it('handles 402 → retry with x-payment header (x402 round-trip)', async () => {
    let calls = 0;
    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'payment_required' }), { status: 402 });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get('x-payment')).toBe('mock');
      return new Response(JSON.stringify({ paid: true }), { status: 200 });
    });

    const buyer = createBuyer({ agent: AGENT, rules: RULES });
    const { response, receipt } = await buyer.fetch('http://localhost/echo', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(receipt.decision).toBe('allow');
  });

  it('denies on disallowed host and emits a deny receipt', async () => {
    const sink: unknown[] = [];
    const buyer = createBuyer({ agent: AGENT, rules: RULES, onReceipt: (r) => void sink.push(r) });

    const { response, receipt } = await buyer.fetch('http://evil.example/echo', { method: 'POST' });

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(receipt.decision).toBe('deny');
    expect(sink).toHaveLength(1);
  });
});

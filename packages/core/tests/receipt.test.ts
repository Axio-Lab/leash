import { describe, expect, it } from 'vitest';
import type { ReceiptV1 } from '@leashmarket/schemas';
import { finalizeReceipt, computeReceiptHash } from '../src/receipt/build.js';
import { verifyReceiptChain } from '../src/receipt/verify.js';

const draft = (nonce: number, prev: string | null, extra?: Partial<ReceiptV1>) =>
  ({
    v: '0.1' as const,
    kind: 'spend' as const,
    agent: 'Agent1111111111111111111111111111111111',
    nonce,
    ts: '2026-01-01T00:00:00.000Z',
    policy_v: '0.1',
    request: { method: 'GET', url: 'https://a', body_hash: null },
    decision: 'allow' as const,
    reason: null,
    price: { amount: '0.01', currency: 'USDC' },
    facilitator: 'local' as const,
    tx_sig: `s${nonce}`,
    response: { status: 200, body_hash: null },
    prev_receipt_hash: prev,
    ...extra,
  }) satisfies Omit<ReceiptV1, 'receipt_hash'>;

describe('finalizeReceipt + verifyReceiptChain', () => {
  it('builds consistent hash', () => {
    const d0 = draft(0, null);
    const r0 = finalizeReceipt(d0);
    expect(r0.receipt_hash).toBe(computeReceiptHash(d0));
  });
  it('verifies two-line chain', () => {
    const r0 = finalizeReceipt(draft(0, null));
    const r1 = finalizeReceipt(draft(1, r0.receipt_hash));
    const lines = [JSON.stringify(r0), JSON.stringify(r1)];
    expect(verifyReceiptChain(lines)).toEqual({ ok: true, count: 2 });
  });
});

import { finalizeReceipt } from '@leashmarket/core';
import { describe, expect, it } from 'vitest';
import { validateReceiptFeed } from '../src/conformance/receipt-feed.js';

const draft = {
  v: '0.1' as const,
  kind: 'spend' as const,
  agent: 'Agent1111111111111111111111111111111111',
  ts: '2026-01-01T00:00:00.000Z',
  policy_v: '0.1',
  request: { method: 'GET', url: 'https://a.com', body_hash: null },
  decision: 'allow' as const,
  reason: null,
  price: { amount: '0.001', currency: 'USDC' },
  facilitator: 'local' as const,
  response: { status: 200, body_hash: null },
};
const line0 = finalizeReceipt({ ...draft, nonce: 0, prev_receipt_hash: null, tx_sig: 's0' });
const line1 = finalizeReceipt({
  ...draft,
  nonce: 1,
  prev_receipt_hash: line0.receipt_hash,
  tx_sig: 's1',
});

describe('validateReceiptFeed', () => {
  it('accepts empty feed', () => {
    expect(validateReceiptFeed('')).toEqual({ ok: true, count: 0 });
  });
  it('rejects invalid json', () => {
    const r = validateReceiptFeed('not-json');
    expect(r.ok).toBe(false);
  });
  it('accepts two-line chain', () => {
    const text = `${JSON.stringify(line0)}\n${JSON.stringify(line1)}\n`;
    expect(validateReceiptFeed(text)).toEqual({ ok: true, count: 2 });
  });
  it('rejects mutated receipt_hash on line 2', () => {
    const tampered = { ...line1, receipt_hash: 'deadbeef' };
    const text = `${JSON.stringify(line0)}\n${JSON.stringify(tampered)}\n`;
    const r = validateReceiptFeed(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(2);
    }
  });
  it('rejects nonce gap', () => {
    const skipped = { ...line1, nonce: 5 };
    const text = `${JSON.stringify(line0)}\n${JSON.stringify(skipped)}\n`;
    const r = validateReceiptFeed(text);
    expect(r.ok).toBe(false);
  });
  it('rejects broken prev_receipt_hash chain', () => {
    const broken = { ...line1, prev_receipt_hash: 'not-the-real-hash' };
    const text = `${JSON.stringify(line0)}\n${JSON.stringify(broken)}\n`;
    const r = validateReceiptFeed(text);
    expect(r.ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  MppChallengeV1Schema,
  ReceiptV02MppSchema,
  ReceiptV02Schema,
  ReceiptV02X402Schema,
  ReceiptV1Schema,
  isReceiptV02,
  parseReceiptAny,
  receiptProtocol,
} from '../src/index.js';

const baseV2 = {
  v: '0.2' as const,
  kind: 'spend' as const,
  agent: 'AssetMint1111111111111111111111111111111',
  nonce: 0,
  ts: '2026-01-01T00:00:00.000Z',
  policy_v: '0.1',
  request: { method: 'GET', url: 'https://example.com', body_hash: null },
  decision: 'allow' as const,
  reason: null,
  price: {
    amount: '0.001',
    currency: 'USDC',
    network: 'solana-devnet',
  },
  facilitator: 'https://facilitator.svmacc.tech',
  response: { status: 200, body_hash: null },
  prev_receipt_hash: null,
  receipt_hash: 'hash-v2-x402',
};

describe('ReceiptV02Schema', () => {
  it('parses x402 variant', () => {
    const r = ReceiptV02X402Schema.parse({
      ...baseV2,
      protocol: 'x402',
      tx_sig: 'sigx',
      payment_requirements_hash: 'abc',
    });
    expect(r.protocol).toBe('x402');
    expect(r.tx_sig).toBe('sigx');
  });

  it('parses mpp variant', () => {
    const r = ReceiptV02MppSchema.parse({
      ...baseV2,
      protocol: 'mpp',
      mpp_challenge_id: 'ch-1',
      mpp_credential_type: 'crypto',
      mpp_settlement_tx: 'sigm',
      mpp_settlement_slot: 123456789,
      tx_sig: 'sigm',
    });
    expect(r.protocol).toBe('mpp');
    expect(r.mpp_settlement_tx).toBe('sigm');
  });

  it('discriminated union accepts both', () => {
    const a = ReceiptV02Schema.parse({ ...baseV2, protocol: 'x402', tx_sig: 's' });
    const b = ReceiptV02Schema.parse({
      ...baseV2,
      receipt_hash: 'hash-mpp',
      protocol: 'mpp',
      mpp_challenge_id: 'c',
      mpp_credential_type: 'crypto',
      mpp_settlement_tx: 't',
      mpp_settlement_slot: '1',
    });
    expect(a.protocol).toBe('x402');
    expect(b.protocol).toBe('mpp');
  });
});

describe('parseReceiptAny', () => {
  it('parses v0.1 as ReceiptV1', () => {
    const v1 = {
      v: '0.1' as const,
      kind: 'spend' as const,
      agent: 'A'.repeat(43),
      nonce: 0,
      ts: '2026-01-01T00:00:00.000Z',
      policy_v: '0.1',
      request: { method: 'GET', url: 'https://x', body_hash: null },
      decision: 'allow' as const,
      reason: null,
      price: { amount: '1', currency: 'USDC' },
      facilitator: 'local' as const,
      tx_sig: 'sig',
      response: { status: 200, body_hash: null },
      prev_receipt_hash: null,
      receipt_hash: 'h1',
    };
    const r = parseReceiptAny(v1);
    expect(r.v).toBe('0.1');
    expect(isReceiptV02(r)).toBe(false);
    expect(receiptProtocol(r)).toBe('x402');
  });

  it('parses v0.2 x402', () => {
    const r = parseReceiptAny({ ...baseV2, protocol: 'x402', tx_sig: 's' });
    expect(isReceiptV02(r)).toBe(true);
    if (isReceiptV02(r)) expect(r.protocol).toBe('x402');
    expect(receiptProtocol(r)).toBe('x402');
  });

  it('parses v0.2 mpp', () => {
    const r = parseReceiptAny({
      ...baseV2,
      receipt_hash: 'hm',
      protocol: 'mpp',
      mpp_challenge_id: 'cid',
      mpp_credential_type: 'crypto',
      mpp_settlement_tx: 'stx',
      mpp_settlement_slot: 1,
    });
    expect(isReceiptV02(r)).toBe(true);
    expect(receiptProtocol(r)).toBe('mpp');
  });

  it('parses JSON string', () => {
    const r = parseReceiptAny(JSON.stringify({ ...baseV2, protocol: 'x402', tx_sig: 's' }));
    expect(ReceiptV02Schema.safeParse(r).success).toBe(true);
  });
});

describe('MppChallengeV1Schema', () => {
  it('parses problem+json 402', () => {
    const c = MppChallengeV1Schema.parse({
      type: 'https://paymentauth.org/problems/payment-required',
      title: 'Payment Required',
      status: 402,
      detail: 'Pay to continue',
      challengeId: 'ch-abc',
      request: {
        recipient: 'PayTo1111111111111111111111111111111111',
        amount: '1000',
        currency: 'USDC',
        network: 'solana-devnet',
        asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
    });
    expect(c.challengeId).toBe('ch-abc');
  });
});

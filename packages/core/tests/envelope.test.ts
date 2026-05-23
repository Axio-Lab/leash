import { describe, expect, it } from 'vitest';
import { buildLeashEnvelope } from '../src/x402/envelope.js';
import {
  LEASH_HEADERS,
  LEASH_HEADERS_EXPOSE,
  buildLeashHeaders,
  parseLeashHeaders,
} from '../src/x402/headers.js';
import { buildWebhookPayload, parseWebhookPayload } from '../src/x402/webhook.js';
import type { ReceiptV1 } from '@leashmarket/schemas';

const RECEIPT: ReceiptV1 = {
  v: '0.1',
  kind: 'earn',
  agent: '33QvAYjEiK8UMrmpy3LW6W8v2wpPMahnw7Jvr7JpeQrR',
  nonce: 0,
  ts: '2026-04-22T00:00:00.000Z',
  policy_v: '0.1',
  request: { method: 'POST', url: 'https://example.com/x/abc', body_hash: null },
  decision: 'allow',
  reason: null,
  price: {
    amount: '1500000',
    currency: 'USDC',
    network: 'solana-devnet',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  },
  facilitator: 'https://facilitator-devnet.leash.market',
  tx_sig: '5sig',
  payment_requirements_hash: null,
  response: { status: 200, body_hash: null },
  prev_receipt_hash: null,
  receipt_hash: 'hash-1',
};

describe('buildLeashEnvelope', () => {
  it('captures core fields from a receipt', () => {
    const envelope = buildLeashEnvelope(RECEIPT, { origin: 'https://example.com' });
    expect(envelope.tx_sig).toBe('5sig');
    expect(envelope.receipt_hash).toBe('hash-1');
    expect(envelope.agent).toBe(RECEIPT.agent);
    expect(envelope.network).toBe('solana-devnet');
    expect(envelope.amount).toEqual({ amount: '1500000', currency: 'USDC' });
    expect(envelope.facilitator).toBe('https://facilitator-devnet.leash.market');
    expect(envelope.explorer.tx).toBe('https://solscan.io/tx/5sig?cluster=devnet');
    expect(envelope.explorer.agent).toBe(`https://example.com/agents/${RECEIPT.agent}`);
  });

  it('honours mainnet network when receipt is mainnet', () => {
    const envelope = buildLeashEnvelope(
      {
        ...RECEIPT,
        price: { ...RECEIPT.price!, network: 'solana-mainnet' },
      },
      { origin: 'https://example.com' },
    );
    expect(envelope.explorer.tx).toBe('https://solscan.io/tx/5sig');
  });

  it('returns null tx explorer link when no signature', () => {
    const envelope = buildLeashEnvelope({ ...RECEIPT, tx_sig: null }, { origin: 'https://x' });
    expect(envelope.explorer.tx).toBeNull();
    expect(envelope.tx_sig).toBeNull();
  });
});

describe('Leash headers', () => {
  it('round-trips an envelope through build + parse', () => {
    const envelope = buildLeashEnvelope(RECEIPT, { origin: 'https://example.com' });
    const headers = buildLeashHeaders(envelope, new Headers());
    expect(headers.get(LEASH_HEADERS.txSig)).toBe('5sig');
    expect(headers.get(LEASH_HEADERS.receiptHash)).toBe('hash-1');
    expect(headers.get('access-control-expose-headers')).toContain(LEASH_HEADERS.txExplorer);
    expect(headers.get('access-control-expose-headers')).toBe(LEASH_HEADERS_EXPOSE);

    const parsed = parseLeashHeaders(headers);
    expect(parsed).toEqual({
      txSig: '5sig',
      receiptHash: 'hash-1',
      agent: RECEIPT.agent,
      txExplorer: envelope.explorer.tx,
      agentExplorer: envelope.explorer.agent,
    });
  });

  it('parses missing headers as null', () => {
    const parsed = parseLeashHeaders(new Headers());
    expect(parsed).toEqual({
      txSig: null,
      receiptHash: null,
      agent: null,
      txExplorer: null,
      agentExplorer: null,
    });
  });

  it('does not duplicate Access-Control-Expose-Headers when called twice', () => {
    const envelope = buildLeashEnvelope(RECEIPT, { origin: 'https://x' });
    const headers = new Headers();
    buildLeashHeaders(envelope, headers);
    buildLeashHeaders(envelope, headers);
    const value = headers.get('access-control-expose-headers') ?? '';
    const parts = value.split(',').map((s) => s.trim());
    const unique = new Set(parts);
    expect(unique.size).toBe(parts.length);
  });
});

describe('webhook payload', () => {
  it('round-trips through build + parse', () => {
    const envelope = buildLeashEnvelope(RECEIPT, { origin: 'https://example.com' });
    const payload = buildWebhookPayload({
      envelope,
      response: { ok: true, message: 'paid' },
      ts: '2026-04-22T00:00:00.000Z',
    });
    const json = JSON.parse(JSON.stringify(payload));
    const parsed = parseWebhookPayload(json);
    expect(parsed.kind).toBe('leash.payment.settled');
    expect(parsed.payment.tx_sig).toBe('5sig');
    expect(parsed.response).toEqual({ ok: true, message: 'paid' });
  });

  it('rejects malformed payloads', () => {
    expect(() => parseWebhookPayload(null)).toThrow();
    expect(() => parseWebhookPayload({ v: '0.2', kind: 'leash.payment.settled' })).toThrow();
    expect(() => parseWebhookPayload({ v: '0.1', kind: 'something.else' })).toThrow();
  });
});

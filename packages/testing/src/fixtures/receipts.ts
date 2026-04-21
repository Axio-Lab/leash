import { finalizeReceipt } from '@leash/core';
import type { ReceiptV1 } from '@leash/schemas';

export const fixtureReceiptSpend: ReceiptV1 = finalizeReceipt({
  v: '0.1',
  kind: 'spend',
  agent: 'Agent1111111111111111111111111111111111',
  nonce: 0,
  ts: '2026-01-01T00:00:00.000Z',
  policy_v: '0.1',
  request: { method: 'GET', url: 'https://example.com/ping', body_hash: null },
  decision: 'allow',
  reason: null,
  price: {
    amount: '0.001',
    currency: 'USDC',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  },
  facilitator: 'local',
  tx_sig: 'mock-abc',
  response: { status: 200, body_hash: null },
  prev_receipt_hash: null,
});

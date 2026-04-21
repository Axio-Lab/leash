import { describe, expect, it } from 'vitest';
import { caip2ForNetwork } from '../src/x402/client.js';
import { paymentRequirementsHash } from '../src/x402/parse.js';

describe('caip2ForNetwork', () => {
  it('returns the real Solana CAIP-2 ids', () => {
    expect(caip2ForNetwork('solana-mainnet')).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    expect(caip2ForNetwork('solana-devnet')).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    expect(caip2ForNetwork('solana-testnet')).toBe('solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z');
  });
});

describe('paymentRequirementsHash', () => {
  const a = {
    scheme: 'exact',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const,
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    payTo: 'AssetSigner111111111111111111111111111111',
    amount: '1000',
    maxTimeoutSeconds: 60,
    extra: { feePayer: 'FacilitatorFeePayer111111111111111111111' } as Record<string, unknown>,
  };

  it('returns null for null input', () => {
    expect(paymentRequirementsHash(null)).toBeNull();
  });

  it('produces a stable digest regardless of key order', () => {
    const reordered = Object.fromEntries([...Object.entries(a)].reverse()) as typeof a;
    expect(paymentRequirementsHash(a)).toBe(paymentRequirementsHash(reordered));
  });

  it('changes when any field changes', () => {
    const h0 = paymentRequirementsHash(a);
    const h1 = paymentRequirementsHash({ ...a, amount: '2000' });
    expect(h0).not.toBe(h1);
  });
});

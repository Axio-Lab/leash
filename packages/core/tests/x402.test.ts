import { describe, expect, it } from 'vitest';
import { caip2ForNetwork } from '../src/x402/client.js';
import { buildPaymentLinkMeta, fetchPaymentLinkMeta } from '../src/x402/discovery.js';
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

describe('fetchPaymentLinkMeta', () => {
  it('parses a discovery payload from a full /x/<id> URL', async () => {
    const meta = await fetchPaymentLinkMeta('https://example.com/x/abc123', {
      fetch: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            kind: 'leash.payment-link',
            endpoint: {
              id: 'abc123',
              label: 'Premium echo',
              description: null,
              method: 'POST',
              url: 'https://example.com/x/abc123',
              price: '$0.001',
              network: 'solana-devnet',
              owner_agent: '33QvAYjEiK8UMrmpy3LW6W8v2wpPMahnw7Jvr7JpeQrR',
              payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
              response: { status: 200, mimeType: 'application/json', body_kind: 'json' },
              hooks: { wrap_receipt: true, webhook_url: null },
              created_at: '2026-04-22T00:00:00.000Z',
              updated_at: '2026-04-22T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    expect(meta.kind).toBe('leash.payment-link');
    expect(meta.endpoint.id).toBe('abc123');
    expect(meta.endpoint.network).toBe('solana-devnet');
  });

  it('builds /x/<id> when called with base URL + id', async () => {
    let seenUrl = '';
    await fetchPaymentLinkMeta('https://example.com', 'xyz789', {
      fetch: async (input) => {
        seenUrl = String(input);
        return new Response(
          JSON.stringify({
            ok: true,
            kind: 'leash.payment-link',
            endpoint: {
              id: 'xyz789',
              label: 'x',
              description: null,
              method: 'GET',
              url: 'https://example.com/x/xyz789',
              price: '1 USDC',
              network: 'solana-mainnet',
              owner_agent: 'Agent11111111111111111111111111111111111111',
              payTo: null,
              response: { status: 200, mimeType: 'application/json', body_kind: 'json' },
              hooks: { wrap_receipt: false, webhook_url: null },
              created_at: '2026-04-22T00:00:00.000Z',
              updated_at: '2026-04-22T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    expect(seenUrl).toBe('https://example.com/x/xyz789');
  });

  it('round-trips through buildPaymentLinkMeta', async () => {
    const built = buildPaymentLinkMeta({
      endpoint: {
        id: 'rt-1',
        label: 'Round-trip link',
        description: 'desc',
        method: 'POST',
        price: '$0.10',
        network: 'solana-devnet',
        owner_agent: '33QvAYjEiK8UMrmpy3LW6W8v2wpPMahnw7Jvr7JpeQrR',
        response: {
          status: 200,
          mimeType: 'application/json',
          body: { ok: true },
        },
        wrap_receipt: true,
        webhook_url: null,
        created_at: '2026-04-22T00:00:00.000Z',
        updated_at: '2026-04-22T00:00:00.000Z',
      },
      origin: 'https://example.com',
      payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
      facilitator: 'https://devnet-facilitator.leash.market',
      docsUrl: 'https://docs.leash.market/guides/create-an-endpoint#facilitator',
    });
    const meta = await fetchPaymentLinkMeta('https://example.com/x/rt-1', {
      fetch: async () =>
        new Response(JSON.stringify(built), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    expect(meta.endpoint.id).toBe('rt-1');
    expect(meta.endpoint.url).toBe('https://example.com/x/rt-1');
    expect(meta.endpoint.response.body_kind).toBe('json');
    expect(meta.endpoint.hooks.wrap_receipt).toBe(true);
    expect(meta.facilitator).toBe('https://devnet-facilitator.leash.market');
  });

  it('derives body_kind="text" when seller body is a string', () => {
    const built = buildPaymentLinkMeta({
      endpoint: {
        id: 'rt-2',
        label: 'Text body',
        method: 'GET',
        price: '$0.01',
        network: 'solana-mainnet',
        owner_agent: 'Agent11111111111111111111111111111111111111',
        response: {
          status: 200,
          mimeType: 'text/plain',
          body: 'hello world',
        },
        wrap_receipt: false,
        created_at: '2026-04-22T00:00:00.000Z',
        updated_at: '2026-04-22T00:00:00.000Z',
      },
      origin: 'https://example.com',
      payTo: null,
    });
    expect(built.endpoint.response.body_kind).toBe('text');
    expect(built.facilitator).toBeUndefined();
  });
});

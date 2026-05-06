/**
 * MPP path coverage for `createBuyer`.
 *
 * The Solana SPL signer flow lives in `@leashmarket/core`'s
 * `buildAndSignMppTransfer` and is exercised end-to-end against a real
 * RPC in the playground; here we mock that helper so the buyer-kit
 * routing logic can be validated without an RPC dependency.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSvmSigner, LeashFetch } from '@leashmarket/core';
import { MPP_PROBLEM_TYPE } from '@leashmarket/core';
import { isReceiptV02, type ReceiptV02Mpp } from '@leashmarket/schemas';

vi.mock('@leashmarket/core', async (importOriginal) => {
  const actual: typeof import('@leashmarket/core') = await importOriginal();
  return {
    ...actual,
    buildAndSignMppTransfer: vi.fn(async () => 'BASE64-WIRE-TX'),
  };
});

import { createBuyer } from '../src/create-buyer.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const SIGNER_ADDRESS = 'SignerExecutiveAddrXXXXXXXXXXXXXXXXXXXXXXXXX';
const stubSigner = { address: SIGNER_ADDRESS } as unknown as ClientSvmSigner;

const rules = {
  v: '0.1' as const,
  budget: { daily: '10', perCall: '1', currency: 'USDC' as const },
  hosts: { allow: ['merchant.test'] },
  triggers: [],
};

const challengeBody = {
  type: MPP_PROBLEM_TYPE,
  status: 402 as const,
  challengeId: 'ch-buyer-1',
  request: {
    recipient: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
    amount: '500000',
    currency: 'USDC',
    network: 'solana-devnet',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    feePayer: 'FYB56sVBW2r4Ka7W9kdJWTPY9FKQLxbT6h4Ysr6aLPZD',
  },
};

function settlementHeaderB64(payload: { tx: string; slot: string | number }): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

describe('createBuyer (MPP)', () => {
  it('routes an MPP 402 → signs → retries → emits a v0.2 mpp receipt', async () => {
    const stubX402Fetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(challengeBody), {
        status: 402,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    const globalFetch = vi.fn(async (_url, init?: RequestInit) => {
      const headers = new Headers(
        (init?.headers ?? {}) as ConstructorParameters<typeof Headers>[0],
      );
      // Verify the buyer attached the PaymentScheme credential on the retry.
      expect(headers.get('authorization')).toMatch(/^PaymentScheme /);
      return new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-payment-receipt': settlementHeaderB64({ tx: 'TX_SIG_MPP_1', slot: 1234 }),
        },
      });
    });
    vi.stubGlobal('fetch', globalFetch);

    const buyer = createBuyer({
      agent: 'AGENT_ASSET_1',
      rules,
      signer: stubSigner,
      fetch: stubX402Fetch,
      networks: ['solana-devnet'],
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });

    expect(result.protocol).toBe('mpp');
    expect(result.response.status).toBe(200);
    expect(isReceiptV02(result.receipt)).toBe(true);
    const r = result.receipt as ReceiptV02Mpp;
    expect(r.protocol).toBe('mpp');
    expect(r.mpp_challenge_id).toBe('ch-buyer-1');
    expect(r.mpp_settlement_tx).toBe('TX_SIG_MPP_1');
    expect(r.mpp_credential_type).toBe('crypto');
    expect(r.tx_sig).toBe('TX_SIG_MPP_1');
    expect(r.decision).toBe('allow');
    expect(r.price?.currency).toBe('USDC');
  });

  it('records a rejected mpp receipt when the seller does not stamp settlement headers', async () => {
    const stubX402Fetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(challengeBody), { status: 402 }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":false}', { status: 200 })),
    );

    const buyer = createBuyer({
      agent: 'AGENT_ASSET_1',
      rules,
      signer: stubSigner,
      fetch: stubX402Fetch,
      networks: ['solana-devnet'],
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });

    expect(result.protocol).toBe('mpp');
    const r = result.receipt as ReceiptV02Mpp;
    expect(r.decision).toBe('rejected');
    expect(r.mpp_settlement_tx).toBe('');
    expect(r.tx_sig).toBeNull();
  });

  it('records mpp_network_unsupported when the seller asks for a network the buyer is not configured for', async () => {
    const mainnetChallenge = {
      ...challengeBody,
      challengeId: 'ch-buyer-2',
      request: { ...challengeBody.request, network: 'solana-mainnet' },
    };
    const stubX402Fetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mainnetChallenge), { status: 402 }));
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);

    const buyer = createBuyer({
      agent: 'AGENT_ASSET_1',
      rules,
      signer: stubSigner,
      fetch: stubX402Fetch,
      // Only configured for devnet — should NOT sign for a mainnet challenge.
      networks: ['solana-devnet'],
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });

    expect(result.protocol).toBe('mpp');
    expect(result.failureReason).toMatch(/mpp_network_unsupported/);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('does not interfere with x402 calls (regression)', async () => {
    // Mimics the existing "200 → allow" test from buyer.test.ts.
    const stubX402Fetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', vi.fn());
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubX402Fetch,
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.protocol).toBe('x402');
    expect(result.receipt.decision).toBe('allow');
    expect(isReceiptV02(result.receipt)).toBe(false);
  });
});

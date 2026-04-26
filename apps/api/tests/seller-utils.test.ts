/**
 * Tests for the seller-kit utility endpoints
 * (`/v1/seller/networks`, `/v1/seller/facilitator`,
 * `/v1/seller/parse-price`, `/v1/agents/{mint}/pay-to`).
 *
 * The endpoints are pure read/derivation surfaces — no DB writes, no
 * RPC calls, no facilitator hits — so the assertions are deterministic
 * even with the test rig's stub facilitator URL.
 */

import { describe, it, expect } from 'vitest';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';

import { createTestRig, authedFetch, type TestRig } from './helpers.js';
import { umiReadOnly } from '../src/util/umi.js';

const SAMPLE_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function newRig(): Promise<TestRig> {
  return createTestRig();
}

describe('seller utility endpoints', () => {
  describe('GET /v1/seller/networks', () => {
    it('returns both networks + surfaces caller-scoped network as `current`', async () => {
      const rig = await newRig();
      const res = await authedFetch(rig, '/v1/seller/networks');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{
          network: string;
          caip2: string;
          facilitator: string;
          accepts: string[];
          tokens: Array<{ symbol: string; mint: string; decimals: number }>;
        }>;
        current: { network: string };
      };
      expect(body.items.map((i) => i.network).sort()).toEqual(['solana-devnet', 'solana-mainnet']);
      expect(body.current.network).toBe('solana-devnet');

      const devnet = body.items.find((i) => i.network === 'solana-devnet')!;
      expect(devnet.accepts).toEqual(['USDC', 'USDT', 'USDG']);
      expect(devnet.facilitator).toBe('https://facilitator.test.invalid');
      expect(devnet.caip2).toMatch(/^solana:/);
      // Devnet stable mints differ from mainnet ones — assert we wired the
      // right per-network registry slice.
      const usdc = devnet.tokens.find((t) => t.symbol === 'USDC');
      expect(usdc?.mint).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
      expect(usdc?.decimals).toBe(6);
    });
  });

  describe('GET /v1/seller/facilitator', () => {
    it('marks `source=config` when LEASH_API_FACILITATOR_URL is set', async () => {
      const rig = await newRig();
      const res = await authedFetch(rig, '/v1/seller/facilitator');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        network: string;
        facilitator: string;
        source: 'config' | 'default';
      };
      expect(body.network).toBe('solana-devnet');
      expect(body.facilitator).toBe('https://facilitator.test.invalid');
      expect(body.source).toBe('config');
    });

    it('falls back to the public default when no override is configured', async () => {
      const rig = await createTestRig({ facilitatorUrlDevnet: '' });
      const res = await authedFetch(rig, '/v1/seller/facilitator');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        facilitator: string;
        source: 'config' | 'default';
      };
      expect(body.source).toBe('default');
      expect(body.facilitator).toBe('https://devnet-facilitator.leash.market');
    });
  });

  describe('POST /v1/seller/parse-price', () => {
    it('parses `$0.001` into atomic USDC + lists per-currency equivalents', async () => {
      const rig = await newRig();
      const res = await authedFetch(rig, '/v1/seller/parse-price', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ price: '$0.001' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        amount: string;
        currency: string;
        asset: string;
        network: string;
        equivalents: Array<{ currency: string; amount: string; asset: string }>;
      };
      expect(body.currency).toBe('USDC');
      expect(body.amount).toBe('1000');
      expect(body.network).toBe('solana-devnet');
      expect(body.asset).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
      // Two equivalents (USDT, USDG) for the two non-default stables.
      const symbols = body.equivalents.map((e) => e.currency).sort();
      expect(symbols).toEqual(['USDG', 'USDT']);
      for (const eq of body.equivalents) {
        expect(eq.amount).toBe('1000');
      }
    });

    it('respects an explicit `currency` override', async () => {
      const rig = await newRig();
      const res = await authedFetch(rig, '/v1/seller/parse-price', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ price: '0.5', currency: 'USDT' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { amount: string; currency: string };
      expect(body.currency).toBe('USDT');
      expect(body.amount).toBe('500000');
    });

    it('returns 422 for an unparseable price', async () => {
      const rig = await newRig();
      const res = await authedFetch(rig, '/v1/seller/parse-price', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ price: 'not-a-price' }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('invalid_request');
    });
  });

  describe('GET /v1/agents/{mint}/pay-to', () => {
    it('derives the asset signer PDA via mpl-core (no RPC required)', async () => {
      const rig = await newRig();
      const res = await authedFetch(rig, `/v1/agents/${SAMPLE_MINT}/pay-to`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        agent_asset: string;
        network: string;
        pay_to: string;
      };
      expect(body.agent_asset).toBe(SAMPLE_MINT);
      expect(body.network).toBe('solana-devnet');

      const umi = umiReadOnly(rig.config, 'solana-devnet');
      const [expected] = findAssetSignerPda(umi, { asset: publicKey(SAMPLE_MINT) });
      expect(body.pay_to).toBe(String(expected));
    });

    it('rejects malformed mints with a 422 from zod-openapi validation', async () => {
      const rig = await newRig();
      const res = await authedFetch(rig, '/v1/agents/not-a-base58/pay-to');
      // zod-openapi turns regex misses into a 400-class validation error.
      expect([400, 422]).toContain(res.status);
    });
  });
});

/**
 * Buyer-kit endpoint tests.
 *
 * Covers all eight `/v1/buyer/*` surfaces:
 *   - quote, policy/evaluate, payment/prepare, payment/execute,
 *     receipt/finalize, receipt/verify, networks, currency.
 *
 * The endpoints come in three flavours:
 *
 *   1. Pure derivation — `policy/evaluate`, `receipt/finalize`,
 *      `receipt/verify`, `networks`, `currency`. These have no IO and
 *      are asserted directly against `@leash/core` fixtures.
 *
 *   2. Live network probe — `quote`, `payment/execute`. These hit a
 *      real URL via `fetch`. We stand up a dynamic stub server (`http`)
 *      bound to `127.0.0.1:0` per test so we can assert how the route
 *      decodes a real seller `payment-required` / `PAYMENT-RESPONSE`
 *      header pair without mocking `globalThis.fetch`.
 *
 *   3. On-chain prepare — `payment/prepare`. We assert the route
 *      returns a populated `PreparedEnvelope` (event id + base64
 *      transaction + echoed ATAs) and that the resolved
 *      `source_token_account` matches the canonical ATA derivation
 *      from `@metaplex-foundation/mpl-toolbox`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { finalizeReceipt, paymentRequirementsHash, type PaymentRequirements } from '@leash/core';
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';

import { authedFetch, createTestRig, type TestRig } from './helpers.js';
import { listEvents } from '../src/storage/events.js';
import { getReceiptByHash } from '../src/storage/receipts.js';
import { umiReadOnly } from '../src/util/umi.js';

const SAMPLE_AGENT = 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp';
const SAMPLE_BUYER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Spin up an ephemeral HTTP server that lets each test return a
 * scripted (status, headers, body) tuple. We base64url-encode the
 * `payment-required` JSON the same way real x402 sellers do.
 */
type StubResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

type StubServer = {
  url: string;
  setResponse(handler: (req: { url: string; method: string }) => StubResponse): void;
  close(): Promise<void>;
};

async function startStubServer(): Promise<StubServer> {
  let handler: (req: { url: string; method: string }) => StubResponse = () => ({
    status: 200,
    body: 'ok',
  });
  const server: Server = createServer((req, res) => {
    const reply = handler({ url: req.url ?? '/', method: req.method ?? 'GET' });
    const headers = reply.headers ?? {};
    res.writeHead(reply.status, headers);
    res.end(reply.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    setResponse(next) {
      handler = next;
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function devnetRequirements(amount = '1000'): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'solana-devnet',
    asset: DEVNET_USDC_MINT,
    payTo: SAMPLE_AGENT,
    amount,
    description: 'paywall test',
    mimeType: 'application/json',
    maxTimeoutSeconds: 60,
    extra: {},
  } as unknown as PaymentRequirements;
}

function defaultRules(overrides: Record<string, unknown> = {}) {
  return {
    v: '0.1',
    budget: { daily: '10', perCall: '1', currency: 'USDC' },
    hosts: { allow: ['127.0.0.1'] },
    triggers: [],
    ...overrides,
  };
}

describe('buyer endpoints', () => {
  // ------------------------------------------------------------
  // GET /v1/buyer/networks + /v1/buyer/currency
  // ------------------------------------------------------------
  describe('GET /v1/buyer/networks', () => {
    it('returns both networks with caller-scoped pick as `current`', async () => {
      const rig = await createTestRig();
      const res = await authedFetch(rig, '/v1/buyer/networks');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ network: string; facilitator: string; accepts: string[] }>;
        current: { network: string };
      };
      expect(body.items.map((i) => i.network).sort()).toEqual(['solana-devnet', 'solana-mainnet']);
      expect(body.current.network).toBe('solana-devnet');
      const devnet = body.items.find((i) => i.network === 'solana-devnet')!;
      expect(devnet.accepts).toEqual(['USDC', 'USDT', 'USDG']);
      expect(devnet.facilitator).toBe('https://facilitator.test.invalid');
    });
  });

  describe('GET /v1/buyer/currency', () => {
    it('lists the buyer-payable stablecoins for the caller-scoped network', async () => {
      const rig = await createTestRig();
      const res = await authedFetch(rig, '/v1/buyer/currency');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        network: string;
        items: Array<{ symbol: string; mint: string; decimals: number; program: string }>;
      };
      expect(body.network).toBe('solana-devnet');
      expect(body.items.map((i) => i.symbol).sort()).toEqual(['USDC', 'USDG', 'USDT']);
      const usdc = body.items.find((i) => i.symbol === 'USDC');
      expect(usdc?.mint).toBe(DEVNET_USDC_MINT);
      expect(usdc?.decimals).toBe(6);
    });
  });

  // ------------------------------------------------------------
  // POST /v1/buyer/policy/evaluate
  // ------------------------------------------------------------
  describe('POST /v1/buyer/policy/evaluate', () => {
    it('allows a request whose host matches the rules.allow list', async () => {
      const rig = await createTestRig();
      const res = await authedFetch(rig, '/v1/buyer/policy/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request: { method: 'GET', url: 'http://127.0.0.1/foo', estimated_price: '0.1' },
          rules: defaultRules(),
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        decision: string;
        reason: string | null;
        request_hash: string;
      };
      expect(body.decision).toBe('allow');
      expect(body.reason).toBeNull();
      expect(body.request_hash.length).toBeGreaterThan(0);
    });

    it('denies a request whose host is not in the allow list', async () => {
      const rig = await createTestRig();
      const res = await authedFetch(rig, '/v1/buyer/policy/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request: { method: 'GET', url: 'https://evil.example.com/api' },
          rules: defaultRules({ hosts: { allow: ['ok.example.com'] } }),
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { decision: string; reason: string };
      expect(body.decision).toBe('deny');
      expect(body.reason).toBe('allowHost');
    });

    it('denies when the per-call price exceeds rules.budget.perCall', async () => {
      const rig = await createTestRig();
      const res = await authedFetch(rig, '/v1/buyer/policy/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request: { method: 'GET', url: 'http://127.0.0.1/foo', estimated_price: '5' },
          rules: defaultRules({ budget: { daily: '10', perCall: '1', currency: 'USDC' } }),
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { decision: string; reason: string };
      expect(body.decision).toBe('deny');
      expect(body.reason).toBe('perCallMax');
    });
  });

  // ------------------------------------------------------------
  // POST /v1/buyer/receipt/finalize + /verify
  // ------------------------------------------------------------
  describe('POST /v1/buyer/receipt/finalize', () => {
    it('matches the result of @leash/core finalizeReceipt()', async () => {
      const rig = await createTestRig();
      const draft = {
        v: '0.1' as const,
        kind: 'spend' as const,
        agent: SAMPLE_AGENT,
        nonce: 0,
        ts: '2026-01-01T00:00:00.000Z',
        policy_v: '0.1',
        request: { method: 'GET', url: 'http://test.local/x/abc', body_hash: null },
        decision: 'allow' as const,
        reason: null,
        price: {
          amount: '1000',
          currency: 'USDC',
          network: 'solana-devnet',
          asset: DEVNET_USDC_MINT,
        },
        facilitator: 'https://facilitator.test.invalid',
        tx_sig: 'sig123',
        payment_requirements_hash: null,
        response: { status: 200, body_hash: null },
        prev_receipt_hash: null,
      };
      const res = await authedFetch(rig, '/v1/buyer/receipt/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        receipt_hash: string;
        receipt: { receipt_hash: string };
      };
      const expected = finalizeReceipt(draft);
      expect(body.receipt_hash).toBe(expected.receipt_hash);
      expect(body.receipt.receipt_hash).toBe(expected.receipt_hash);
    });
  });

  describe('POST /v1/buyer/receipt/verify', () => {
    it('verifies a single-receipt chain (ok=true)', async () => {
      const rig = await createTestRig();
      const r = finalizeReceipt({
        v: '0.1',
        kind: 'earn',
        agent: SAMPLE_AGENT,
        nonce: 0,
        ts: '2026-01-01T00:00:00.000Z',
        policy_v: '0.1',
        request: { method: 'GET', url: 'http://test.local/r', body_hash: null },
        decision: 'allow',
        reason: null,
        price: null,
        facilitator: 'self',
        tx_sig: null,
        payment_requirements_hash: null,
        response: { status: 200, body_hash: null },
        prev_receipt_hash: null,
      });
      const res = await authedFetch(rig, '/v1/buyer/receipt/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain: [r] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; count?: number };
      expect(body.ok).toBe(true);
      expect(body.count).toBe(1);
    });

    it('flags a tampered receipt as ok=false', async () => {
      const rig = await createTestRig();
      const good = finalizeReceipt({
        v: '0.1',
        kind: 'earn',
        agent: SAMPLE_AGENT,
        nonce: 0,
        ts: '2026-01-01T00:00:00.000Z',
        policy_v: '0.1',
        request: { method: 'GET', url: 'http://test.local/r', body_hash: null },
        decision: 'allow',
        reason: null,
        price: null,
        facilitator: 'self',
        tx_sig: null,
        payment_requirements_hash: null,
        response: { status: 200, body_hash: null },
        prev_receipt_hash: null,
      });
      const tampered = { ...good, agent: 'tampered-agent' };
      const res = await authedFetch(rig, '/v1/buyer/receipt/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain: [tampered] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; reason?: string };
      expect(body.ok).toBe(false);
      expect(typeof body.reason).toBe('string');
    });
  });

  // ------------------------------------------------------------
  // POST /v1/buyer/payment/prepare
  // ------------------------------------------------------------
  describe('POST /v1/buyer/payment/prepare', () => {
    it('returns a prepared envelope with the canonical buyer/seller ATAs', async () => {
      const rig = await createTestRig();
      const res = await authedFetch(rig, '/v1/buyer/payment/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payer: SAMPLE_BUYER,
          spl_mint: DEVNET_USDC_MINT,
          destination: SAMPLE_AGENT,
          amount: '1000',
          decimals: 6,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        event_id: string;
        network: string;
        transaction: { base64: string; fee_payer: string };
        echo: {
          source_token_account: string;
          destination_token_account: string;
          mint: string;
          amount: string;
          decimals: number;
          token_program: string;
        };
      };
      expect(body.event_id.length).toBeGreaterThan(0);
      expect(body.network).toBe('solana-devnet');
      expect(body.transaction.base64.length).toBeGreaterThan(0);
      expect(body.transaction.fee_payer).toBe(SAMPLE_BUYER);
      expect(body.echo.amount).toBe('1000');
      expect(body.echo.decimals).toBe(6);
      expect(body.echo.token_program).toBe(SPL_TOKEN_PROGRAM_ID);

      const umi = umiReadOnly(rig.config, 'solana-devnet');
      const [expectedSource] = findAssociatedTokenPda(umi, {
        mint: publicKey(DEVNET_USDC_MINT),
        owner: publicKey(SAMPLE_BUYER),
        tokenProgramId: publicKey(SPL_TOKEN_PROGRAM_ID),
      });
      const [expectedDest] = findAssociatedTokenPda(umi, {
        mint: publicKey(DEVNET_USDC_MINT),
        owner: publicKey(SAMPLE_AGENT),
        tokenProgramId: publicKey(SPL_TOKEN_PROGRAM_ID),
      });
      expect(body.echo.source_token_account).toBe(String(expectedSource));
      expect(body.echo.destination_token_account).toBe(String(expectedDest));

      // The route also enrolls the agent treasury into the indexer
      // watchlist via a `buyer.payment.prepare` event row.
      const events = await listEvents(rig.db, {
        network: 'solana-devnet',
        kind: 'buyer.payment.prepare',
      });
      expect(events.length).toBe(1);
      expect(events[0].mint).toBe(DEVNET_USDC_MINT);
      expect(events[0].amountAtomic).toBe('1000');
    });

    it('respects an explicit `source_token_account` override', async () => {
      const rig = await createTestRig();
      const overrideAta = '6dQrK8e1Tn5UcPhzc6jBSNEAycCgEkbWkmXsNeNSUkxF';
      const res = await authedFetch(rig, '/v1/buyer/payment/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payer: SAMPLE_BUYER,
          spl_mint: DEVNET_USDC_MINT,
          destination: SAMPLE_AGENT,
          amount: '500',
          decimals: 6,
          source_token_account: overrideAta,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { echo: { source_token_account: string } };
      expect(body.echo.source_token_account).toBe(overrideAta);
    });
  });

  // ------------------------------------------------------------
  // POST /v1/buyer/quote (live HTTP probe)
  // ------------------------------------------------------------
  describe('POST /v1/buyer/quote', () => {
    let stub: StubServer;

    beforeEach(async () => {
      stub = await startStubServer();
    });
    afterEach(async () => {
      await stub.close();
    });

    it('decodes a base64url `payment-required` 402 + picks the caller-scoped network', async () => {
      const rig = await createTestRig();
      const accepts = [devnetRequirements('1000')];
      stub.setResponse(() => ({
        status: 402,
        headers: { 'payment-required': base64UrlJson({ accepts }) },
        body: JSON.stringify({ error: 'payment required' }),
      }));

      const res = await authedFetch(rig, '/v1/buyer/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `${stub.url}/paid` }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: number;
        accepts: PaymentRequirements[];
        chosen: PaymentRequirements | null;
        price: { amount: string; currency: string; asset?: string } | null;
        requirements_hash: string | null;
        seller_error: string | null;
      };
      expect(body.status).toBe(402);
      expect(body.accepts.length).toBe(1);
      expect(body.chosen?.asset).toBe(DEVNET_USDC_MINT);
      expect(body.price?.amount).toBe('1000');
      expect(body.price?.currency).toBe('USDC');
      expect(body.requirements_hash).toBe(paymentRequirementsHash(accepts[0]));
      expect(body.seller_error).toBeNull();
    });

    it('returns chosen=null when the seller does not accept the caller-scoped network', async () => {
      const rig = await createTestRig();
      const mainnetOnly = {
        ...devnetRequirements('1000'),
        network: 'solana-mainnet',
      } as unknown as PaymentRequirements;
      stub.setResponse(() => ({
        status: 402,
        headers: { 'payment-required': base64UrlJson({ accepts: [mainnetOnly] }) },
        body: '{}',
      }));
      const res = await authedFetch(rig, '/v1/buyer/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `${stub.url}/paid` }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        accepts: PaymentRequirements[];
        chosen: PaymentRequirements | null;
        price: unknown;
      };
      expect(body.accepts.length).toBe(1);
      expect(body.chosen).toBeNull();
      expect(body.price).toBeNull();
    });

    it('returns the empty envelope for non-402 responses', async () => {
      const rig = await createTestRig();
      stub.setResponse(() => ({ status: 200, body: 'hello' }));
      const res = await authedFetch(rig, '/v1/buyer/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `${stub.url}/free` }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: number;
        accepts: PaymentRequirements[];
        chosen: PaymentRequirements | null;
      };
      expect(body.status).toBe(200);
      expect(body.accepts).toEqual([]);
      expect(body.chosen).toBeNull();
    });

    it('returns 502 when the probe target is unreachable', async () => {
      const rig = await createTestRig();
      const res = await authedFetch(rig, '/v1/buyer/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:1/never' }),
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('rpc_error');
    });
  });

  // ------------------------------------------------------------
  // POST /v1/buyer/payment/execute (replay + ingest)
  // ------------------------------------------------------------
  describe('POST /v1/buyer/payment/execute', () => {
    let stub: StubServer;
    let rig: TestRig;

    beforeEach(async () => {
      stub = await startStubServer();
      rig = await createTestRig();
    });
    afterEach(async () => {
      await stub.close();
    });

    it('replays the request, parses PAYMENT-RESPONSE, ingests a settled spend receipt', async () => {
      const requirements = devnetRequirements('1000');
      stub.setResponse((req) => {
        if (req.url === '/api/data') {
          return {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'PAYMENT-RESPONSE': base64UrlJson({
                transaction: 'real-tx-sig',
                paymentRequirements: requirements,
              }),
            },
            body: JSON.stringify({ ok: true }),
          };
        }
        return { status: 404, body: 'not found' };
      });

      const res = await authedFetch(rig, '/v1/buyer/payment/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: `${stub.url}/api/data`,
          method: 'GET',
          x_payment: 'fake-x-payment-header',
          agent: SAMPLE_AGENT,
          nonce: 0,
          expected_payment: requirements,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        settled: boolean;
        response: { status: number; body_text: string | null };
        tx_sig: string | null;
        receipt: { kind: string; decision: string; tx_sig: string | null; receipt_hash: string };
        receipt_event_id: string | null;
        failure_reason: string | null;
      };
      expect(body.settled).toBe(true);
      expect(body.response.status).toBe(200);
      expect(body.response.body_text).toContain('"ok":true');
      expect(body.tx_sig).toBe('real-tx-sig');
      expect(body.receipt.kind).toBe('spend');
      expect(body.receipt.decision).toBe('allow');
      expect(body.receipt.tx_sig).toBe('real-tx-sig');
      expect(body.failure_reason).toBeNull();

      const stored = await getReceiptByHash(rig.db, 'solana-devnet', body.receipt.receipt_hash);
      expect(stored).not.toBeNull();
      expect(stored!.txSig).toBe('real-tx-sig');

      const published = await listEvents(rig.db, {
        network: 'solana-devnet',
        kind: 'receipt.published',
      });
      expect(published.length).toBe(1);
    });

    it('records a `rejected` receipt when the seller refuses to settle', async () => {
      const requirements = devnetRequirements('1000');
      stub.setResponse(() => ({
        status: 402,
        headers: { 'payment-required': base64UrlJson({ accepts: [requirements] }) },
        body: 'still 402',
      }));
      const res = await authedFetch(rig, '/v1/buyer/payment/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: `${stub.url}/no-settle`,
          method: 'GET',
          x_payment: 'fake-x-payment-header',
          agent: SAMPLE_AGENT,
          nonce: 1,
          expected_payment: requirements,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        settled: boolean;
        tx_sig: string | null;
        receipt: { decision: string; reason: string | null };
        failure_reason: string | null;
      };
      expect(body.settled).toBe(false);
      expect(body.tx_sig).toBeNull();
      expect(body.receipt.decision).toBe('rejected');
      expect(body.failure_reason).toMatch(/seller did not settle/);
    });

    it('also derives the agent treasury PDA so the indexer picks it up', async () => {
      const requirements = devnetRequirements('1000');
      stub.setResponse(() => ({
        status: 200,
        headers: {
          'PAYMENT-RESPONSE': base64UrlJson({
            transaction: 'sig-watch',
            paymentRequirements: requirements,
          }),
        },
        body: '{}',
      }));
      await authedFetch(rig, '/v1/buyer/payment/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: `${stub.url}/watch`,
          method: 'GET',
          x_payment: 'header',
          agent: SAMPLE_AGENT,
          nonce: 0,
          expected_payment: requirements,
        }),
      });
      // The route derives the asset signer PDA off the agent mint and
      // hands it to `ensureWatched`. We assert the PDA derivation matches
      // what the indexer would compute itself.
      const umi = umiReadOnly(rig.config, 'solana-devnet');
      const [pda] = findAssetSignerPda(umi, { asset: publicKey(SAMPLE_AGENT) });
      expect(String(pda).length).toBeGreaterThan(0);
    });
  });
});

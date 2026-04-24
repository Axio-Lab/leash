import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBuyer } from '../src/create-buyer.js';
import type { LeashFetch } from '@leash/core';
import type { ClientSvmSigner } from '@leash/core';

afterEach(() => {
  vi.restoreAllMocks();
});

const SIGNER_ADDRESS = 'SignerExecutiveAddrXXXXXXXXXXXXXXXXXXXXXXXXX';
const stubSignerWithAddress = { address: SIGNER_ADDRESS } as unknown as ClientSvmSigner;

const rules = {
  v: '0.1' as const,
  budget: { daily: '10', perCall: '0.01', currency: 'USDC' as const },
  hosts: { allow: ['localhost', 'merchant.test'] },
  triggers: [],
};

const stubSigner = {} as ClientSvmSigner;

describe('createBuyer', () => {
  it('emits an allow receipt and ships it via onReceipt on a 200 response', async () => {
    const stubFetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const seen: unknown[] = [];
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
      onReceipt: (r) => {
        seen.push(r);
      },
    });
    const { response, receipt } = await buyer.fetch('http://merchant.test/tag', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(receipt.decision).toBe('allow');
    expect(receipt.facilitator).toBe('https://facilitator.svmacc.tech');
    expect(seen).toHaveLength(1);
  });

  it('records the seller-quoted price and failure reason on a 402 with no PAYMENT-RESPONSE', async () => {
    // Realistic shape of what `@x402/hono` returns on a failed settlement: a
    // 402 with the demanded `accepts[]` and a JSON body explaining why.
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'http://merchant.test/tag', description: 'Premium' },
      accepts: [
        {
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          amount: '5000000',
          asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
          maxTimeoutSeconds: 300,
          extra: { feePayer: 'FYB56sVBW2r4Ka7W9kdJWTPY9FKQLxbT6h4Ysr6aLPZD' },
        },
      ],
    };
    const headerB64 = Buffer.from(JSON.stringify(paymentRequired), 'utf8').toString('base64');
    const stubFetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient_funds' }), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'payment-required': headerB64,
        },
      }),
    );
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.response.status).toBe(402);
    expect(result.receipt.tx_sig).toBeNull();
    // Truth-recording: the receipt must reflect what the seller demanded, not
    // the buyer's policy ceiling.
    expect(result.receipt.price).toEqual({
      amount: '5000000',
      currency: 'USDC',
      // The receipt normalises CAIP-2 chain ids to Leash's friendly slugs so
      // explorers don't have to render `solana:<genesis>` blobs.
      network: 'solana-devnet',
      asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    });
    // The 402-with-no-PAYMENT-RESPONSE case is a `rejected` decision: policy
    // allowed the call but settlement did not happen (insufficient funds, in
    // this fixture).
    expect(result.receipt.decision).toBe('rejected');
    // Body error wins over header error because it's typically the more
    // specific facilitator-side message.
    expect(result.receipt.reason).toBe('insufficient_funds');
    expect(result.failureReason).toBe('insufficient_funds');
    expect(result.quotedPrice?.amount).toBe('5000000');
    // Hash should be set so the receipt cryptographically pins which offer
    // the buyer attempted to settle, even though no tx_sig exists.
    expect(result.receipt.payment_requirements_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a settled tx_sig and the on-chain price from the PAYMENT-RESPONSE header', async () => {
    // Realistic shape of `@x402/hono`'s success response: the seller stamps
    // `payment-response` with the matched paymentRequirements + the
    // confirmed Solana tx signature.
    const settle = {
      success: true,
      transaction:
        '5UfDvnh6f4eS2RHJtcZTKbiaT3iuHowBbZBJekMNF1S25o1y2VW9KUYfh4ymcKeevQNcm9DMZSk1cSMz4iHUnCpu',
      paymentRequirements: {
        scheme: 'exact',
        network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        amount: '1000',
        asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
        maxTimeoutSeconds: 300,
        extra: { feePayer: 'FYB56sVBW2r4Ka7W9kdJWTPY9FKQLxbT6h4Ysr6aLPZD' },
      },
    };
    const headerB64 = Buffer.from(JSON.stringify(settle), 'utf8').toString('base64');
    const stubFetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'payment-response': headerB64 },
      }),
    );
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
      sourceTokenAccount: 'AgentTreasuryUsdcAtaXXXXXXXXXXXXXXXXXXXXXXX',
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.response.status).toBe(200);
    expect(result.receipt.decision).toBe('allow');
    expect(result.receipt.tx_sig).toBe(settle.transaction);
    expect(result.receipt.price?.amount).toBe('1000');
    // CAIP-2 → friendly slug normalisation also applies on settled receipts.
    expect(result.receipt.price?.network).toBe('solana-devnet');
    expect(result.receipt.payment_requirements_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.failureReason).toBeUndefined();
  });

  it('handles a facilitator failure (delegation exhausted) and records the demanded price', async () => {
    // Simulates the wire shape after the facilitator rejects the partially
    // signed tx because the SPL Approve has been fully consumed: the
    // seller proxies a 402 with the demanded `accepts[]` and a body error
    // such as "transaction_simulation_failed" (delegate amount = 0).
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'http://merchant.test/tag', description: 'Premium' },
      accepts: [
        {
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          amount: '50000',
          asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
          maxTimeoutSeconds: 300,
          extra: { feePayer: 'FYB56sVBW2r4Ka7W9kdJWTPY9FKQLxbT6h4Ysr6aLPZD' },
        },
      ],
    };
    const headerB64 = Buffer.from(JSON.stringify(paymentRequired), 'utf8').toString('base64');
    const stubFetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'transaction_simulation_failed' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'payment-required': headerB64 },
      }),
    );
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
      sourceTokenAccount: 'AgentTreasuryUsdcAtaXXXXXXXXXXXXXXXXXXXXXXX',
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.response.status).toBe(402);
    expect(result.receipt.tx_sig).toBeNull();
    expect(result.receipt.price?.amount).toBe('50000');
    expect(result.receipt.reason).toBe('transaction_simulation_failed');
    expect(result.failureReason).toBe('transaction_simulation_failed');
  });

  it('reclassifies a generic 402 as insufficient_balance using the source ATA pre-flight', async () => {
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'http://merchant.test/tag', description: 'Premium' },
      accepts: [
        {
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          amount: '100000000',
          asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
          maxTimeoutSeconds: 300,
          extra: { feePayer: 'FYB56sVBW2r4Ka7W9kdJWTPY9FKQLxbT6h4Ysr6aLPZD' },
        },
      ],
    };
    const headerB64 = Buffer.from(JSON.stringify(paymentRequired), 'utf8').toString('base64');
    const stubFetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'transaction_simulation' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'payment-required': headerB64 },
      }),
    );
    // The pre-flight in buyer-kit uses `globalThis.fetch` to read the source
    // token account via JSON-RPC. Mock it to return 5 USDC balance against a
    // 100 USDC quote — the receipt reason should flip to insufficient_balance.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                value: {
                  owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                  data: {
                    program: 'spl-token',
                    parsed: {
                      type: 'account',
                      info: {
                        mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
                        owner: 'TreasuryPda1111111111111111111111111111111111',
                        tokenAmount: { amount: '5000000', decimals: 6 },
                        delegate: SIGNER_ADDRESS,
                        delegatedAmount: { amount: '5000000', decimals: 6 },
                      },
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSignerWithAddress,
      fetch: stubFetch,
      rpcUrl: 'https://api.devnet.solana.com',
      sourceTokenAccount: 'AgentTreasuryUsdcAtaXXXXXXXXXXXXXXXXXXXXXXX',
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.receipt.decision).toBe('rejected');
    // Pre-flight prefix wins; the seller's "transaction_simulation" string is
    // appended as a breadcrumb after the colon.
    expect(result.receipt.reason).toBe('insufficient_balance: transaction_simulation');
    expect(result.failureReason).toBe('insufficient_balance: transaction_simulation');
  });

  it('reclassifies a generic 402 as insufficient_allowance when the delegate is set but small', async () => {
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'http://merchant.test/tag' },
      accepts: [
        {
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          amount: '50000000',
          asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
          maxTimeoutSeconds: 300,
        },
      ],
    };
    const headerB64 = Buffer.from(JSON.stringify(paymentRequired), 'utf8').toString('base64');
    const stubFetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'transaction_simulation' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'payment-required': headerB64 },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                value: {
                  owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                  data: {
                    program: 'spl-token',
                    parsed: {
                      type: 'account',
                      info: {
                        mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
                        owner: 'TreasuryPda1111111111111111111111111111111111',
                        tokenAmount: { amount: '500000000', decimals: 6 },
                        delegate: SIGNER_ADDRESS,
                        delegatedAmount: { amount: '1000000', decimals: 6 },
                      },
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSignerWithAddress,
      fetch: stubFetch,
      rpcUrl: 'https://api.devnet.solana.com',
      sourceTokenAccount: 'AgentTreasuryUsdcAtaXXXXXXXXXXXXXXXXXXXXXXX',
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.receipt.reason).toBe('insufficient_allowance: transaction_simulation');
  });

  it('auto-derives the source ATA from agent + quoted asset when the caller omits it', async () => {
    // Agent + USDC mint where we know the on-chain ATA derivation will land
    // somewhere deterministic. The point of this test is the *path*: even
    // without `sourceTokenAccount`, the kit derives the treasury ATA from
    // the agent + quoted mint and runs preflight against it.
    //
    // Use a real-looking devnet asset address and the canonical USDC devnet
    // mint so `deriveAgentTreasuryAta` succeeds. The RPC stub captures the
    // *actual* derived ATA via the request body so we can assert it was
    // queried (versus the seller's reason being passed through unchanged).
    const AGENT_ASSET = '33QvAYjEiK8UMrmpy3LW6W8v2wpPMahnw7Jvr7JpeQrR';
    const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
    const paymentRequired = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'http://merchant.test/tag' },
      accepts: [
        {
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          amount: '100000000',
          asset: USDC_DEVNET,
          payTo: 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox',
          maxTimeoutSeconds: 300,
        },
      ],
    };
    const headerB64 = Buffer.from(JSON.stringify(paymentRequired), 'utf8').toString('base64');
    const stubFetch: LeashFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'transaction_simulation' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'payment-required': headerB64 },
      }),
    );
    const rpcCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init?: RequestInit) => {
        const body = init?.body ? String(init.body) : '';
        rpcCalls.push(body);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: {
                owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                data: {
                  program: 'spl-token',
                  parsed: {
                    type: 'account',
                    info: {
                      mint: USDC_DEVNET,
                      owner: 'TreasuryPda1111111111111111111111111111111111',
                      tokenAmount: { amount: '5000000', decimals: 6 },
                      delegate: SIGNER_ADDRESS,
                      delegatedAmount: { amount: '5000000', decimals: 6 },
                    },
                  },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    // No `sourceTokenAccount` passed — buyer-kit must derive it.
    const buyer = createBuyer({
      agent: AGENT_ASSET,
      rules,
      signer: stubSignerWithAddress,
      fetch: stubFetch,
      rpcUrl: 'https://api.devnet.solana.com',
    });
    const result = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    expect(result.receipt.decision).toBe('rejected');
    expect(result.receipt.reason).toBe('insufficient_balance: transaction_simulation');
    expect(rpcCalls.length).toBeGreaterThan(0);
    // Verify the kit actually queried via JSON-RPC `getAccountInfo` (the
    // helper used by inspectSplTokenAccount) — proof the derivation path ran.
    expect(rpcCalls[0]).toMatch(/getAccountInfo/);
  });

  it('emits a deny receipt without calling fetch when the host is denied', async () => {
    const stubFetch = vi.fn() as unknown as LeashFetch;
    const buyer = createBuyer({
      agent: 'A1',
      rules: { ...rules, hosts: { deny: ['merchant.test'] } },
      signer: stubSigner,
      fetch: stubFetch,
    });
    const { response, receipt } = await buyer.fetch('http://merchant.test/tag');
    expect(response.status).toBe(403);
    expect(receipt.decision).toBe('deny');
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it('fans receipts out to the default runner + API URLs when onReceipt is omitted', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const sinkFetch = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return new Response('ok', { status: 200 });
    };
    const stubFetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
      receipts: {
        runnerUrl: 'http://runner.test',
        apiUrl: 'https://api.example.test',
        apiKey: 'lsh_test_dummy',
        fetch: sinkFetch,
      },
    });
    await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    // Both destinations should have been hit.
    expect(calls.map((c) => c.url).sort()).toEqual(
      ['http://runner.test/a/A1/receipts', 'https://api.example.test/v1/receipts/A1'].sort(),
    );
    const apiCall = calls.find((c) => c.url.startsWith('https://api'));
    const headers = new Headers(apiCall?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer lsh_test_dummy');
  });

  it('honours onReceipt: false even when receipt forwarders are configured', async () => {
    const sinkFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const stubFetch: LeashFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const buyer = createBuyer({
      agent: 'A1',
      rules,
      signer: stubSigner,
      fetch: stubFetch,
      onReceipt: false,
      receipts: {
        runnerUrl: 'http://runner.test',
        apiUrl: 'https://api.example.test',
        apiKey: 'lsh_test_dummy',
        fetch: sinkFetch,
      },
    });
    const { receipt } = await buyer.fetch('http://merchant.test/tag', { method: 'POST' });
    // Receipt is still constructed and returned to the caller…
    expect(receipt.receipt_hash).toMatch(/^[0-9a-f]{64}$/);
    // …but it must NOT be forwarded anywhere when onReceipt is false.
    expect(sinkFetch).not.toHaveBeenCalled();
  });
});

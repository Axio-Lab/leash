/**
 * `LeashClient` smoke tests.
 *
 * Each test installs a fake `fetch` impl that records the request
 * shape (URL, method, headers, body) so we can assert the wire
 * contract without a live API. The signing tests round-trip
 * `signRequest` → `buildEnvelope` against a freshly generated
 * ed25519 keypair to confirm the envelope matches the API
 * verifier's contract.
 */

import { generateSigner, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { describe, expect, it } from 'vitest';

import { LeashClient, LeashError } from '../src/client.js';
import { buildEnvelope } from '../src/sign.js';

function freshExecutive(): { pubkey: string; secretBase58: string } {
  const umi = createUmi('https://invalid');
  const signer = generateSigner(umi);
  const kp = umi.eddsa.createKeypairFromSecretKey(signer.secretKey);
  return {
    pubkey: kp.publicKey.toString(),
    secretBase58: base58.deserialize(kp.secretKey)[0],
  };
}

function fakeMint(): string {
  const umi = createUmi('https://invalid');
  return generateSigner(umi).publicKey.toString();
}

type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
};

function makeFetch(respond: (req: RecordedRequest) => { status: number; body: unknown }): {
  fetch: typeof globalThis.fetch;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const fetchImpl = (async (
    input: string | URL | { url: string; toString(): string },
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    }
    const req: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(req);
    const { status, body } = respond(req);
    return new Response(body == null ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

describe('LeashClient (public reads)', () => {
  it('discover() formats query params + parses items', async () => {
    const { fetch, calls } = makeFetch(() => ({
      status: 200,
      body: {
        items: [
          {
            source: 'leash',
            url: 'https://x',
            title: 'T',
            description: 'D',
            slug: 's',
            category: 'c',
            price_usdc: '0.1',
            pricing_type: 'per_call',
            seller_agent_mint: null,
            seller_wallet: 'W',
            rating: 1,
            health_status: 'ok',
            tags: [],
            tools: [],
          },
        ],
        next_cursor: null,
      },
    }));
    const client = new LeashClient({ baseUrl: 'https://api.test', fetchImpl: fetch });
    const res = await client.discover({ capability: 'ocr', max_price_usdc: 0.5 });
    expect(res.items).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.test/v1/discover?capability=ocr&max_price_usdc=0.5');
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('reputation() includes the network query param', async () => {
    const { fetch, calls } = makeFetch(() => ({
      status: 200,
      body: {
        agent_mint: 'M',
        network: 'solana-devnet',
        total_volume_usdc: '0',
        settled_calls: 0,
        denied_calls: 0,
        distinct_counterparties: 0,
        dispute_rate: 0,
        oldest_receipt_at: null,
        newest_receipt_at: null,
        rating: 0,
      },
    }));
    const client = new LeashClient({ baseUrl: 'https://api.test', fetchImpl: fetch });
    await client.reputation({ agentMint: 'M', network: 'solana-mainnet' });
    expect(calls[0]!.url).toBe('https://api.test/v1/agents/M/reputation?network=solana-mainnet');
  });

  it('throws LeashError on non-2xx with the parsed body', async () => {
    const { fetch } = makeFetch(() => ({
      status: 503,
      body: { message: 'maintenance' },
    }));
    const client = new LeashClient({ baseUrl: 'https://api.test', fetchImpl: fetch });
    await expect(client.discover()).rejects.toMatchObject({
      message: 'maintenance',
      status: 503,
    });
  });
});

describe('LeashClient (X-Leash-Sig auth)', () => {
  it('createWebhook() stamps a fresh signature whose envelope matches', async () => {
    const exec = freshExecutive();
    const mint = fakeMint();
    const { fetch, calls } = makeFetch((req) => {
      const agent = req.headers['x-leash-agent']!;
      expect(agent).toBe(mint);
      return {
        status: 200,
        body: {
          id: 'wh_1',
          agent_mint: agent,
          network: 'solana-devnet',
          url: JSON.parse(req.body!).url,
          events: [],
          disabled_at: null,
          created_at: '2026-04-30T00:00:00.000Z',
          secret: 'whsec_x',
        },
      };
    });

    const client = new LeashClient({
      baseUrl: 'https://api.test',
      agentMint: mint,
      executiveSecretBase58: exec.secretBase58,
      fetchImpl: fetch,
    });
    const res = await client.createWebhook({ url: 'https://hooks.test/in' });
    expect(res.id).toBe('wh_1');

    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.headers['x-leash-agent']).toBe(mint);
    expect(call.headers['x-leash-timestamp']).toMatch(/Z$/);
    expect(call.headers['x-leash-sig']).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    // Independently re-derive the envelope + sig — proves the
    // signing primitives in `sign.ts` produce something a verifier
    // can check against a known-good envelope.
    const envelope = await buildEnvelope({
      method: 'POST',
      pathWithQuery: `/v1/agents/${mint}/webhooks`,
      timestamp: call.headers['x-leash-timestamp']!,
      body: call.body,
      agentMint: mint,
    });
    const umi = createUmi('https://invalid');
    const ok = umi.eddsa.verify(
      envelope,
      base58.serialize(call.headers['x-leash-sig']!),
      publicKey(exec.pubkey),
    );
    expect(ok).toBe(true);
  });

  it('webhook methods throw LeashError without an agent identity', async () => {
    const { fetch } = makeFetch(() => ({ status: 200, body: {} }));
    const client = new LeashClient({ baseUrl: 'https://api.test', fetchImpl: fetch });
    await expect(client.listWebhooks()).rejects.toBeInstanceOf(LeashError);
  });
});

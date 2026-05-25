/**
 * Focused devnet e2e for POST hosted payment links with:
 *   - metadata.upstream_url
 *   - metadata.expected_request_body
 *   - a real buyer-supplied JSON body forwarded after settlement
 *
 * The upstream is a temporary local HTTP server. This is still a real
 * end-to-end payment test: buyer-kit probes the hosted /x/{id} URL and
 * submits an on-chain devnet settlement before the API forwards the body.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';

import { createBuyer } from '@leashmarket/buyer-kit';
import { getSpendDelegation, setSpendDelegation } from '@leashmarket/registry-utils';

const API_URL = (process.env.LEASH_E2E_API_URL ?? 'http://127.0.0.1:8801').replace(/\/+$/, '');
const API_KEY = required('LEASH_E2E_API_KEY');
const OWNER_SECRET = required('LEASH_E2E_OWNER_SECRET');
const BUYER_AGENT = required('LEASH_E2E_BUYER_AGENT');
const SELLER_AGENT = required('LEASH_E2E_SELLER_AGENT');
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const USDC_MINT = process.env.LEASH_E2E_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PRICE = process.env.LEASH_E2E_PRICE ?? '$0.001';
const DELEGATE_USDC = BigInt(process.env.LEASH_E2E_DELEGATE_USDC ?? '100000');

type ApiInit = Omit<RequestInit, 'headers' | 'body'> & {
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus?: number | number[];
};

type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
};

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`missing env ${key}`);
  return value;
}

function decodeSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return Uint8Array.from(JSON.parse(trimmed) as number[]);
  return base58.serialize(trimmed);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const expect = init.expectStatus ?? 200;
  const expected = Array.isArray(expect) ? expect : [expect];
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${API_KEY}`,
    ...(init.headers ?? {}),
  };
  if (init.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const parsed = text.length > 0 ? safeJson(text) : null;
  if (!expected.includes(res.status)) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}\n${text.slice(0, 800)}`);
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function startTemporaryUpstream(): Promise<{
  upstreamUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url?.split('?')[0] !== '/design') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const bodyText = await readRequestBody(req);
    requests.push({
      method: req.method,
      url: req.url ?? '/',
      headers: req.headers,
      bodyText,
    });

    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        upstream: 'temporary-design-agent',
        received: safeJson(bodyText),
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object', 'temporary upstream did not bind to a port');
  return {
    upstreamUrl: `http://127.0.0.1:${address.port}/design?source=e2e`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('Leash upstream POST body e2e');
  console.log('============================================================');
  console.log(`api   : ${API_URL}`);
  console.log(`rpc   : ${RPC}`);
  console.log(`price : ${PRICE}`);

  const upstream = await startTemporaryUpstream();
  console.log(`upstream: ${upstream.upstreamUrl}`);

  let createdId: string | null = null;
  try {
    const health = await api<{ ok: boolean }>('/v1/health');
    assert(health.ok, 'API health check failed');
    console.log('  ✓ API health OK');

    const ownerSecret = decodeSecret(OWNER_SECRET);
    const ownerSigner = await createKeyPairSignerFromBytes(ownerSecret);
    const ownerPubkey = String(ownerSigner.address);
    const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
    umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(ownerSecret)));

    const delegation = await getSpendDelegation(umi, {
      agentAsset: BUYER_AGENT,
      mint: USDC_MINT,
    });
    console.log(`  · buyer treasury balance: ${delegation.balance.toString()} atomic USDC`);
    console.log(`  · current allowance     : ${delegation.delegatedAmount.toString()} atomic USDC`);
    if (delegation.balance <= 0n) {
      throw new Error(
        `buyer treasury has no USDC. Fund ${delegation.sourceTokenAccount} and rerun.`,
      );
    }
    if (delegation.delegate !== ownerPubkey || delegation.delegatedAmount < 1000n) {
      const approval = await setSpendDelegation(umi, {
        agentAsset: BUYER_AGENT,
        mint: USDC_MINT,
        executive: ownerPubkey,
        amount: DELEGATE_USDC,
      });
      console.log(`  ✓ spend delegation approved: ${approval.signature}`);
    }

    const expectedRequestBody = {
      prompt: 'string',
      style: 'string',
      format: 'string',
    };
    const buyerRequestBody = {
      prompt: 'Design a landing page for a Leash seller agent',
      style: 'premium dark mode',
      format: 'html',
    };

    const id = `post-body-design-${Date.now()}`;
    const link = await api<{
      id: string;
      share_url: string;
      metadata: Record<string, unknown>;
    }>('/v1/payment-links', {
      method: 'POST',
      body: {
        id,
        label: 'temporary design agent',
        owner_agent: SELLER_AGENT,
        method: 'POST',
        protocol: 'x402',
        price: PRICE,
        currency: 'USDC',
        accepts_currencies: [],
        response: {
          status: 200,
          mimeType: 'application/json',
          body: {
            ok: true,
            message: 'Payment accepted. Call the protected endpoint to receive live data.',
            upstream_url: upstream.upstreamUrl,
          },
        },
        metadata: {
          upstream_url: upstream.upstreamUrl,
          provider_url: new URL(upstream.upstreamUrl).origin,
          pricing_type: 'fixed',
          expected_request_body: expectedRequestBody,
        },
      },
    });
    createdId = link.id;
    assert(
      JSON.stringify(link.metadata.expected_request_body) === JSON.stringify(expectedRequestBody),
      'payment link did not persist expected_request_body metadata',
    );

    const localShareUrl = `${API_URL}/x/${encodeURIComponent(link.id)}?network=solana-devnet`;
    console.log(`  ✓ payment link id : ${link.id}`);
    console.log(`  · API share_url   : ${link.share_url}`);
    console.log(`  · test share_url  : ${localShareUrl}`);

    const probe = await fetch(localShareUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(buyerRequestBody),
    });
    assert(probe.status === 402, `unpaid probe should be 402, got ${probe.status}`);
    assert(upstream.requests.length === 0, 'upstream should not be called before settlement');
    console.log('  ✓ unpaid POST probe returned 402 without calling upstream');

    const buyer = createBuyer({
      agent: BUYER_AGENT,
      rules: {
        v: '0.1',
        budget: { daily: '10', perCall: '0.01', currency: 'USDC' },
        hosts: { allow: [new URL(localShareUrl).hostname] },
        triggers: [],
      },
      signer: ownerSigner,
      networks: ['solana-devnet'],
      rpcUrl: RPC,
      sourceTokenAccount: delegation.sourceTokenAccount,
    });

    console.log('  · paying hosted POST endpoint...');
    const paid = await buyer.fetch(localShareUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(buyerRequestBody),
    });
    assert(
      paid.response.status === 201,
      `paid response should be 201, got ${paid.response.status}`,
    );
    assert(paid.receipt.tx_sig, 'paid response did not include a settlement tx signature');

    const body = (await paid.response.json()) as {
      ok?: boolean;
      upstream?: string;
      received?: unknown;
    };
    assert(body.ok === true, 'upstream response should be ok');
    assert(body.upstream === 'temporary-design-agent', 'wrong upstream response marker');
    assert(
      JSON.stringify(body.received) === JSON.stringify(buyerRequestBody),
      'wrong response echo',
    );
    const recordedRequests = [...upstream.requests];
    assert(
      recordedRequests.length === 1,
      `expected one upstream call, got ${recordedRequests.length}`,
    );

    const recorded = recordedRequests[0]!;
    assert(recorded.method === 'POST', `upstream method should be POST, got ${recorded.method}`);
    assert(recorded.url.includes('source=e2e'), 'upstream query string was not preserved');
    assert(
      JSON.stringify(safeJson(recorded.bodyText)) === JSON.stringify(buyerRequestBody),
      'upstream did not receive the exact buyer request body',
    );
    assert(!('x-payment' in recorded.headers), 'payment header leaked to upstream');

    console.log(`  ✓ paid response status : ${paid.response.status}`);
    console.log(`  ✓ settlement tx_sig    : ${paid.receipt.tx_sig}`);
    console.log(`  ✓ upstream body        : ${recorded.bodyText}`);
  } finally {
    if (createdId) {
      await api(`/v1/payment-links/${encodeURIComponent(createdId)}`, {
        method: 'DELETE',
        expectStatus: [200, 204],
      }).catch((err) => console.warn(`  ! cleanup delete failed: ${(err as Error).message}`));
    }
    await upstream.close();
    console.log('  ✓ temporary upstream closed');
  }
}

main().catch((err) => {
  console.error('\n✗ upstream POST body e2e failed');
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

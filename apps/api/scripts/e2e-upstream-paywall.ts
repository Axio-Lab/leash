/**
 * Focused devnet e2e for hosted payment links with metadata.upstream_url.
 *
 * This mirrors the marketplace /creator/monetize payload: create a GET payment
 * link with a static fallback response plus metadata.upstream_url, then pay the
 * hosted /x/{id} URL and assert the buyer receives the upstream API response.
 */

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
const UPSTREAM_URL =
  process.env.LEASH_E2E_UPSTREAM_URL ?? 'https://jsonplaceholder.typicode.com/posts';

type ApiInit = Omit<RequestInit, 'headers' | 'body'> & {
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus?: number | number[];
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

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('Leash upstream paywall e2e');
  console.log('============================================================');
  console.log(`api      : ${API_URL}`);
  console.log(`rpc      : ${RPC}`);
  console.log(`upstream : ${UPSTREAM_URL}`);
  console.log(`price    : ${PRICE}`);

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
    throw new Error(`buyer treasury has no USDC. Fund ${delegation.sourceTokenAccount} and rerun.`);
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

  const id = `jsonplaceholder-posts-${Date.now()}`;
  const link = await api<{
    id: string;
    share_url: string;
    accepts: Array<{ amount: string; currency: string; asset: string }>;
  }>('/v1/payment-links', {
    method: 'POST',
    body: {
      id,
      label: 'jsonplaceholder posts',
      owner_agent: SELLER_AGENT,
      method: 'GET',
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
          upstream_url: UPSTREAM_URL,
        },
      },
      metadata: {
        upstream_url: UPSTREAM_URL,
        provider_url: new URL(UPSTREAM_URL).origin,
        pricing_type: 'fixed',
        free_tier: 0,
      },
    },
  });
  const localShareUrl = `${API_URL}/x/${encodeURIComponent(link.id)}?network=solana-devnet`;
  console.log(`  ✓ payment link id : ${link.id}`);
  console.log(`  · API share_url   : ${link.share_url}`);
  console.log(`  · test share_url  : ${localShareUrl}`);

  const probe = await fetch(localShareUrl, { headers: { accept: 'application/json' } });
  assert(probe.status === 402, `unpaid probe should be 402, got ${probe.status}`);
  console.log('  ✓ unpaid probe returned 402');

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

  console.log('  · paying hosted endpoint...');
  const paid = await buyer.fetch(localShareUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  assert(paid.response.status === 200, `paid response should be 200, got ${paid.response.status}`);
  assert(paid.receipt.tx_sig, 'paid response did not include a settlement tx signature');

  const body = (await paid.response.json()) as unknown;
  assert(Array.isArray(body), 'paid response body should be the JSONPlaceholder posts array');
  assert(body.length > 0, 'paid response body should include at least one post');
  const first = body[0] as { id?: unknown; title?: unknown; body?: unknown };
  assert(first.id === 1, `first upstream post id should be 1, got ${String(first.id)}`);
  assert(typeof first.title === 'string', 'first upstream post title should be a string');

  console.log(`  ✓ paid response status : ${paid.response.status}`);
  console.log(`  ✓ settlement tx_sig    : ${paid.receipt.tx_sig}`);
  console.log(`  ✓ upstream posts count : ${body.length}`);
  console.log(`  ✓ first post title     : ${first.title}`);
}

main().catch((err) => {
  console.error('\n✗ upstream paywall e2e failed');
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

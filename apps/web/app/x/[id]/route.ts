import { AsyncLocalStorage } from 'node:async_hooks';
import { NextResponse } from 'next/server';
import { Hono, type Context } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';
import type { EndpointV1, ReceiptV1 } from '@leash/schemas';
import { EndpointV1Schema } from '@leash/schemas';
import { RUNNER_URL, SOLANA_RPC } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public, shareable x402 paywall.
 *
 * Resolves an `EndpointV1` from the runner by id, then mounts the real
 * `@leash/seller-kit` `createSeller` middleware on a one-shot Hono app to
 * gate the request. On success the configured response template is
 * returned, an `earn` `ReceiptV1` is shipped to the runner, and the
 * response is post-processed according to the endpoint config:
 *
 *   - `redirect_url`  → 303 to that URL with the payment proof appended
 *                       as `?leash_tx=…&leash_receipt=…&leash_agent=…`
 *   - `wrap_receipt`  → JSON body becomes `{ data: <user-body>, _leash: {...} }`
 *   - `webhook_url`   → fire-and-forget POST of `{ payment, response }`
 *                       to the URL after settlement
 *   - `x-leash-callback` request header → same webhook behaviour, but
 *                       buyer-supplied (per-call). Fired in addition to
 *                       `webhook_url` if both are set.
 *   - `X-Leash-*` response headers stamped on every successful settlement
 */

const SOLSCAN_CLUSTER: Record<EndpointV1['network'], string> = {
  'solana-mainnet': '',
  'solana-devnet': '?cluster=devnet',
  'solana-testnet': '?cluster=testnet',
};

type ReceiptHolder = { receipt: ReceiptV1 | null };
const receiptStore = new AsyncLocalStorage<ReceiptHolder>();

async function loadEndpoint(id: string): Promise<EndpointV1 | null> {
  try {
    const res = await fetch(new URL(`/endpoints/${encodeURIComponent(id)}`, RUNNER_URL), {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return EndpointV1Schema.parse(json);
  } catch {
    return null;
  }
}

async function postReceipt(receipt: ReceiptV1): Promise<void> {
  await fetch(`${RUNNER_URL}/a/${receipt.agent}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(receipt),
  }).catch(() => {
    /* runner outage must not surface as a paying customer's HTTP error */
  });
}

function networkAlias(network: EndpointV1['network']): 'solana-devnet' | 'solana-mainnet' {
  if (network === 'solana-mainnet') return 'solana-mainnet';
  // Fold testnet → devnet for v0.1 (no testnet facilitator exists).
  return 'solana-devnet';
}

type LeashEnvelope = {
  tx_sig: string | null;
  receipt_hash: string;
  agent: string;
  network: string | null;
  amount: { amount: string; currency: string } | null;
  facilitator: string | null;
  explorer: { tx: string | null; agent: string };
};

function buildEnvelope(
  receipt: ReceiptV1,
  origin: string,
  network: EndpointV1['network'],
): LeashEnvelope {
  const cluster = SOLSCAN_CLUSTER[network] ?? '';
  return {
    tx_sig: receipt.tx_sig ?? null,
    receipt_hash: receipt.receipt_hash,
    agent: receipt.agent,
    network: receipt.price?.network ?? null,
    amount: receipt.price
      ? { amount: receipt.price.amount, currency: receipt.price.currency }
      : null,
    facilitator: receipt.facilitator ?? null,
    explorer: {
      tx: receipt.tx_sig ? `https://solscan.io/tx/${receipt.tx_sig}${cluster}` : null,
      agent: `${origin}/agents/${receipt.agent}`,
    },
  };
}

/**
 * Apply the post-payment side-effects — header stamping, optional body
 * envelope, redirect, and webhook fire-and-forget. Returns the new
 * Response that should replace the seller's response.
 */
async function finalizeResponse(
  res: Response,
  endpoint: EndpointV1,
  receipt: ReceiptV1,
  req: Request,
): Promise<Response> {
  const origin = new URL(req.url).origin;
  const envelope = buildEnvelope(receipt, origin, endpoint.network);
  const callerCallback = req.headers.get('x-leash-callback');

  // 1. Build the canonical payload (used for both webhook + optional body wrap).
  let bodyText = await res.text();
  let parsedBody: unknown = bodyText;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = bodyText;
    }
  } else {
    parsedBody = null;
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const headers = new Headers(res.headers);
  headers.set('x-leash-tx-sig', envelope.tx_sig ?? '');
  headers.set('x-leash-receipt-hash', envelope.receipt_hash);
  headers.set('x-leash-agent', envelope.agent);
  if (envelope.explorer.tx) headers.set('x-leash-tx-explorer', envelope.explorer.tx);
  headers.set('x-leash-agent-explorer', envelope.explorer.agent);
  headers.set(
    'access-control-expose-headers',
    'x-leash-tx-sig, x-leash-receipt-hash, x-leash-agent, x-leash-tx-explorer, x-leash-agent-explorer',
  );

  // 2. Fire webhooks (fire-and-forget so a slow downstream doesn't block the buyer).
  const webhookPayload = JSON.stringify({ payment: envelope, response: parsedBody });
  const webhooks = [endpoint.webhook_url, callerCallback].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  for (const url of webhooks) {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: webhookPayload,
    }).catch(() => {
      /* webhook outages are silent; receipt feed is the source of truth */
    });
  }

  // 3. Optional 303 redirect to a thank-you page with the payment proof inline.
  if (endpoint.redirect_url) {
    const target = new URL(endpoint.redirect_url);
    if (envelope.tx_sig) target.searchParams.set('leash_tx', envelope.tx_sig);
    target.searchParams.set('leash_receipt', envelope.receipt_hash);
    target.searchParams.set('leash_agent', envelope.agent);
    headers.set('location', target.toString());
    return new Response(null, { status: 303, headers });
  }

  // 4. Optional JSON body wrap so callers get the receipt inline.
  if (endpoint.wrap_receipt && isJson) {
    bodyText = JSON.stringify({ data: parsedBody, _leash: envelope });
    headers.set('content-length', String(Buffer.byteLength(bodyText, 'utf8')));
    return new Response(bodyText, { status: res.status, headers });
  }

  // 5. Pass-through (still with X-Leash-* headers stamped).
  return new Response(bodyText, { status: res.status, headers });
}

function buildApp(endpoint: EndpointV1, pathname: string): Hono {
  const umi = createUmi(SOLANA_RPC).use(mplCore());
  const app = new Hono();

  // Outer post-processor — reads the captured receipt out of AsyncLocalStorage
  // (populated by `onReceipt` below) and applies the configured side-effects.
  app.use(async (c, next) => {
    const holder: ReceiptHolder = { receipt: null };
    await receiptStore.run(holder, () => next());
    if (!holder.receipt || !c.res || c.res.status >= 400) return;
    c.res = await finalizeResponse(c.res, endpoint, holder.receipt, c.req.raw);
  });

  createSeller(app, {
    umi,
    sellerAgent: { asset: endpoint.owner_agent },
    network: networkAlias(endpoint.network),
    routes: {
      [`${endpoint.method} ${pathname}`]: {
        description: endpoint.label,
        price: endpoint.price,
        mimeType: endpoint.response.mimeType,
      },
    },
    onReceipt: async (r) => {
      const holder = receiptStore.getStore();
      if (holder) holder.receipt = r;
      await postReceipt(r);
    },
  });

  const handler = (c: Context) => {
    const body = endpoint.response.body;
    if (typeof body === 'string') {
      return new Response(body, {
        status: endpoint.response.status,
        headers: { 'content-type': endpoint.response.mimeType },
      });
    }
    return c.json(body);
  };

  if (endpoint.method === 'GET') app.get(pathname, handler);
  else app.post(pathname, handler);
  return app;
}

async function dispatch(req: Request, id: string): Promise<Response> {
  const endpoint = await loadEndpoint(id);
  if (!endpoint) {
    return NextResponse.json(
      {
        error: 'endpoint_not_found',
        detail: `No payment-link endpoint registered with id="${id}". Did you delete it, or is the runner down?`,
      },
      { status: 404 },
    );
  }
  const u = new URL(req.url);
  const app = buildApp(endpoint, u.pathname);
  return app.fetch(req);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return dispatch(req, id);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return dispatch(req, id);
}

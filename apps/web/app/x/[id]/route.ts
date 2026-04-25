import { AsyncLocalStorage } from 'node:async_hooks';
import { NextResponse } from 'next/server';
import { Hono, type Context } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller, networkAlias, resolveSellerPayTo } from '@leash/seller-kit';
import {
  LEASH_CALLBACK_HEADER,
  buildLeashEnvelope,
  buildLeashHeaders,
  buildPaymentLinkMeta,
  buildWebhookPayload,
  type PaymentLinkMeta,
} from '@leash/core';
import { createRunnerClient } from '@leash/runner';
import type { EndpointV1, ReceiptV1 } from '@leash/schemas';
import { FACILITATOR_URL, RUNNER_URL, SOLANA_RPC } from '@/lib/env';

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
 *   - `wrap_receipt`  → JSON body becomes `{ data: <user-body>, _leash: {...} }`
 *   - `webhook_url`   → fire-and-forget POST of `WebhookPayload` to the URL
 *                       after settlement (built via `@leash/core`)
 *   - `x-leash-callback` request header → same webhook behaviour, but
 *                       buyer-supplied (per-call). Fired in addition to
 *                       `webhook_url` if both are set.
 *   - `X-Leash-*` response headers stamped on every successful settlement
 *
 * Every wire concern (envelope shape, header names, webhook payload) lives
 * in `@leash/core` so the producer + consumer share a single contract.
 */

type ReceiptHolder = { receipt: ReceiptV1 | null };
const receiptStore = new AsyncLocalStorage<ReceiptHolder>();

const runner = createRunnerClient({ url: RUNNER_URL });

async function loadEndpoint(id: string): Promise<EndpointV1 | null> {
  try {
    return await runner.endpoints.get(id);
  } catch {
    return null;
  }
}

async function postReceipt(receipt: ReceiptV1): Promise<void> {
  try {
    await runner.receipts.post(receipt);
  } catch {
    /* runner outage must not surface as a paying customer's HTTP error */
  }
}

/**
 * Apply the post-payment side-effects — header stamping, optional body
 * envelope, and webhook fire-and-forget. Returns the new Response that
 * should replace the seller's response.
 */
async function finalizeResponse(
  res: Response,
  endpoint: EndpointV1,
  receipt: ReceiptV1,
  req: Request,
): Promise<Response> {
  const origin = new URL(req.url).origin;
  const envelope = buildLeashEnvelope(receipt, {
    origin,
    network: networkAlias(endpoint.network) === 'solana-mainnet' ? 'mainnet' : 'devnet',
  });
  const callerCallback = req.headers.get(LEASH_CALLBACK_HEADER);

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
  buildLeashHeaders(envelope, headers);

  // 2. Fire webhooks (fire-and-forget so a slow downstream doesn't block the buyer).
  const webhookBody = JSON.stringify(buildWebhookPayload({ envelope, response: parsedBody }));
  const webhooks = [endpoint.webhook_url, callerCallback].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  for (const url of webhooks) {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: webhookBody,
    }).catch(() => {
      /* webhook outages are silent; receipt feed is the source of truth */
    });
  }

  // 3. Optional JSON body wrap so callers get the receipt inline.
  if (endpoint.wrap_receipt && isJson) {
    bodyText = JSON.stringify({ data: parsedBody, _leash: envelope });
    headers.set('content-length', String(Buffer.byteLength(bodyText, 'utf8')));
    return new Response(bodyText, { status: res.status, headers });
  }

  // 4. Pass-through (still with X-Leash-* headers stamped).
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
    facilitator: FACILITATOR_URL,
    routes: {
      [`${endpoint.method} ${pathname}`]: {
        description: endpoint.label,
        price: endpoint.price,
        currency: endpoint.currency,
        acceptsCurrencies: endpoint.accepts_currencies,
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

/**
 * Build a public, no-payment "what is this link?" descriptor. Returned when a
 * client probes `/x/<id>` without an `X-PAYMENT` header on a method that
 * doesn't match the configured `endpoint.method` (typically a browser GET to
 * a POST-only paywall) or any browser-like Accept.
 *
 * Delegates to {@link buildPaymentLinkMeta} from `@leash/core` so the wire
 * shape stays in sync with the SDK consumer ({@link fetchPaymentLinkMeta}).
 */
function buildDiscoveryPayload(req: Request, endpoint: EndpointV1): PaymentLinkMeta {
  const origin = new URL(req.url).origin;
  const umi = createUmi(SOLANA_RPC).use(mplCore());
  let payTo: string | null = null;
  try {
    payTo = resolveSellerPayTo(umi, { asset: endpoint.owner_agent });
  } catch {
    /* mint may be unrecognised on this RPC — payTo is best-effort */
  }
  return buildPaymentLinkMeta({
    endpoint: {
      id: endpoint.id,
      label: endpoint.label,
      description: endpoint.description ?? null,
      method: endpoint.method,
      price: endpoint.price,
      currency: endpoint.currency,
      accepts_currencies: endpoint.accepts_currencies,
      network: endpoint.network,
      owner_agent: endpoint.owner_agent,
      response: {
        status: endpoint.response.status,
        mimeType: endpoint.response.mimeType,
        body: endpoint.response.body,
      },
      webhook_url: endpoint.webhook_url ?? null,
      wrap_receipt: endpoint.wrap_receipt,
      created_at: endpoint.created_at,
      updated_at: endpoint.updated_at,
    },
    origin,
    payTo,
    facilitator: FACILITATOR_URL,
    docsUrl: 'https://leash.svmacc.tech/docs/playground/seller',
  });
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

  // Discovery shortcut: plain browser visits should always see metadata,
  // even for GET-configured links. We detect "browser intent" by Accept:
  // text/html. x402 clients still receive the real 402/payment flow because
  // they either send X-PAYMENT on replay, or use non-browser accepts.
  const reqMethod = req.method.toUpperCase();
  const hasPaymentHeader =
    req.headers.has('x-payment') || req.headers.has('X-PAYMENT'.toLowerCase());
  const accept = req.headers.get('accept')?.toLowerCase() ?? '';
  const browserLike = accept.includes('text/html');
  const methodMismatched = endpoint.method !== 'GET';
  if (!hasPaymentHeader && reqMethod === 'GET' && (methodMismatched || browserLike)) {
    return NextResponse.json(buildDiscoveryPayload(req, endpoint), { status: 200 });
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

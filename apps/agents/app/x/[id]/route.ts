/**
 * Same-origin BFF proxy for x402 paywalls.
 *
 * The chat agent's Pay card (`pay-request-artifact.tsx`) calls the
 * buyer-kit in the browser, which attaches a custom `X-PAYMENT` header
 * to the seller's `/x/<id>` URL. When that URL points at a different
 * origin (e.g. a Cloudflare tunnel or `api.leash.market`), the browser
 * issues a CORS preflight that any non-CORS-enabled paywall will fail —
 * surfacing as the generic "Failed to fetch" error in the chat.
 *
 * Mirroring the `apps/web` playground, we expose a same-origin
 * `/x/[id]` here that streams the request and response between the
 * browser and the upstream `apps/api` paywall verbatim. Because both
 * sides of the buyer-kit dance now happen against the same origin
 * (`agents.leash.market` / `localhost:4100`), there's no preflight at
 * all — and nothing in the seller-kit math changes because the request
 * URL the seller verifies is still the canonical one served by
 * `apps/api`.
 *
 * We forward all relevant headers in BOTH directions, including the
 * `X-PAYMENT` request header and the `PAYMENT-RESPONSE` /
 * `payment-required` / `X-Leash-*` response headers the buyer-kit
 * reads to finalize the receipt.
 *
 * Pure passthrough — no auth, no body inspection. The upstream paywall
 * is the public protocol surface; we just relay it over the same
 * origin so the browser stops fighting us.
 */

import { type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxy(req: NextRequest, id: string): Promise<Response> {
  const env = getServerEnv();
  const upstreamBase = env.leashApiUrl.replace(/\/+$/, '');
  const search = req.nextUrl.search; // includes leading '?' or empty
  const upstream = `${upstreamBase}/x/${encodeURIComponent(id)}${search}`;

  // Strip Next.js / Vercel-specific headers, keep everything else
  // (especially `X-PAYMENT`, `Content-Type`, and `Accept`). We do NOT
  // forward cookies or `Authorization` — the paywall is anonymous.
  const fwdHeaders = new Headers();
  req.headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'cookie' ||
      lower === 'authorization' ||
      lower.startsWith('x-vercel-') ||
      lower.startsWith('x-forwarded-')
    ) {
      return;
    }
    fwdHeaders.set(k, v);
  });

  const init: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return new Response(JSON.stringify({ error: 'paywall_unreachable', message, upstream }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Reflect every header the buyer-kit expects to read for settlement.
  const outHeaders = new Headers();
  upstreamRes.headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    // Drop hop-by-hop and Next/Vercel internals; keep everything else.
    if (
      lower === 'transfer-encoding' ||
      lower === 'connection' ||
      lower === 'keep-alive' ||
      lower === 'content-encoding'
    ) {
      return;
    }
    outHeaders.set(k, v);
  });

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy(req, id);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy(req, id);
}

export async function OPTIONS(_req: NextRequest) {
  // Same-origin requests don't actually need preflight, but Next.js
  // routes are happiest when OPTIONS is explicit. Mirror what we'd
  // accept from the buyer-kit for symmetry.
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Accept, Authorization, X-PAYMENT, X-Leash-Callback',
      'Access-Control-Max-Age': '600',
    },
  });
}

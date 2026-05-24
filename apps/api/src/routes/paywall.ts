/**
 * Public x402 paywall — `GET /x/{id}` and `POST /x/{id}`.
 *
 * This is the public face of every payment link created via
 * `POST /v1/payment-links`. It is the *only* surface in the entire API
 * that does not require an API key — anonymous x402 buyers must be able
 * to pay it without coordinating with us first.
 *
 * Per request we:
 *   1. Resolve the payment link by `(network, id)`. Network defaults to
 *      mainnet but may be overridden via `?network=solana-devnet`. If
 *      the slug is missing or the link is disabled we 404 / 410.
 *   2. Bump `payment_links.call_count` (so the explorer shows traffic
 *      for probes too — both the unpaid 402 and the paid retry hit
 *      this counter).
 *   3. Spin up a per-request `Hono` sub-app and register exactly one
 *      route at `link.method link.path` whose handler calls the stored
 *      upstream URL after settlement, falling back to the configured
 *      response template when no upstream is attached.
 *   4. Wrap that sub-app with `createSeller` (x402) or `createMppSeller`
 *      (MPP) so probes return the right 402 shape, then settle on the
 *      matching credential (`X-PAYMENT` vs `Authorization: PaymentScheme`).
 *   5. Forward the original `Request` into the sub-app and return the
 *      sub-app's `Response` verbatim.
 *
 * The seller-kit's `onReceipt` callback fires only on successful
 * settlement. We use it to:
 *   - persist the receipt (`ReceiptV1` or `ReceiptV02`) in our `receipts` table
 *   - bump `payment_links.settled_count` + record the latest tx sig
 *   - emit `payment_link.served` + `payment_link.settled` events so the
 *     explorer's activity feed and any subscribed webhooks light up.
 *
 * The receipt sink is wired up with `onReceipt: <closure>`, NOT the
 * env-driven runner/api forwarder, because we *are* the API. We also
 * set `LEASH_RECEIPTS_DISABLED` semantics implicitly by passing a
 * direct callback.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import {
  createSeller,
  createMppSeller,
  createInMemoryChallengeStore,
  type ChallengeStore,
} from '@leashmarket/seller-kit';
import { buildLeashEnvelope, buildLeashHeaders } from '@leashmarket/core';
import type { ReceiptAny } from '@leashmarket/schemas';
import { isReceiptV02 } from '@leashmarket/schemas';

import { resolveMppFeePayer } from '../util/mpp-fee-payer.js';
import { type LeashApiConfig, facilitatorForNetwork } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import {
  getPaymentLink,
  recordCall,
  recordSettlement,
  type PaymentLinkRow,
} from '../storage/payment-links.js';
import { ingestReceipt } from '../storage/receipts.js';
import { createPreparedEvent, markConfirmed, markSubmitted } from '../storage/events.js';
import { emitProtocolFeeEvent } from '../storage/fee-events.js';
import { ensureWatched } from '../indexer/watchlist.js';
import { umiReadOnly } from '../util/umi.js';
import { isSvmNetwork, type SvmNetwork } from '../util/network.js';
import type { CacheClient } from '../storage/redis.js';

export type PaywallRoutesDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

/**
 * Build the public Hono app responsible for `/x/:id`. Mount it BEFORE
 * the API-key middleware so anonymous buyers can reach it.
 */
export function buildPaywallRoutes(deps: PaywallRoutesDeps): Hono {
  const app = new Hono();

  // Enable CORS for the public paywall surface. The paywall is meant to
  // be reachable from any origin (anyone with the share URL can pay it),
  // and the buyer-kit attaches an `X-PAYMENT` header that the browser
  // treats as non-simple — which forces a CORS preflight (OPTIONS). We
  // need to:
  //   - reflect `Origin: *` so cross-origin browser buyers can reach us
  //   - whitelist `X-PAYMENT` + the standard request headers
  //   - expose every Leash-specific response header the buyer-kit reads
  //     to extract the settlement (`PAYMENT-RESPONSE`, `X-PAYMENT-RESPONSE`,
  //     `payment-required`, and the `X-Leash-*` settlement breadcrumbs)
  // Without this the browser silently blocks the preflight and the
  // buyer-kit surfaces the request as a generic "Failed to fetch".
  app.use(
    '/x/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-PAYMENT', 'X-Leash-Callback'],
      exposeHeaders: [
        'PAYMENT-RESPONSE',
        'X-PAYMENT-RESPONSE',
        'payment-required',
        'x-payment-receipt',
        'X-Leash-Tx-Sig',
        'X-Leash-Receipt-Hash',
        'X-Leash-Agent',
        'X-Leash-Tx-Explorer',
        'X-Leash-Agent-Explorer',
      ],
      maxAge: 600,
    }),
  );

  app.all('/x/:id', async (c) => {
    const id = c.req.param('id');
    const queryNetwork = c.req.query('network');
    let link = null as Awaited<ReturnType<typeof getPaymentLink>> | null;
    let network: SvmNetwork;
    if (queryNetwork) {
      network = resolveNetwork(queryNetwork);
      link = await getPaymentLink(deps.db, network, id);
    } else {
      const [mainnet, devnet] = await Promise.all([
        getPaymentLink(deps.db, 'solana-mainnet', id),
        getPaymentLink(deps.db, 'solana-devnet', id),
      ]);
      link = mainnet ?? devnet;
      network = mainnet ? 'solana-mainnet' : 'solana-devnet';
    }
    if (!link) {
      if (queryNetwork) {
        const sibling = network === 'solana-mainnet' ? 'solana-devnet' : 'solana-mainnet';
        const onSibling = await getPaymentLink(deps.db, sibling, id);
        if (onSibling) {
          return c.json(
            {
              error: 'wrong_network',
              message: `payment link "${id}" exists on ${sibling}, not ${network}. Append ?network=${sibling} to the URL.`,
            },
            404,
          );
        }
      }
      return c.json({ error: 'not_found', message: `payment link "${id}" not found` }, 404);
    }
    if (link.disabledAt) {
      return c.json({ error: 'gone', message: `payment link "${id}" is disabled` }, 410);
    }
    if (link.method !== c.req.method.toUpperCase()) {
      return c.json(
        {
          error: 'method_not_allowed',
          message: `payment link "${id}" only accepts ${link.method}`,
        },
        405,
      );
    }

    // Bump call_count on every probe — this is intentional. Both the
    // initial 402 probe AND the paid retry count as "calls" so the
    // explorer surfaces real traffic, not just the (always-smaller)
    // settled count.
    await recordCall(deps.db, { network, id });

    let mppFeePayer: string | undefined;
    if (link.protocol === 'mpp') {
      try {
        mppFeePayer = await resolveMppFeePayer(deps.config, network);
      } catch (e) {
        return c.json(
          {
            error: 'mpp_config',
            message: e instanceof Error ? e.message : 'could not resolve MPP fee payer',
          },
          503,
        );
      }
    }

    const sellerApp = buildSellerSubApp(deps, link, mppFeePayer);
    const holder: ReceiptHolder = { receipt: null };
    const res = await receiptStore.run(holder, () => sellerApp.fetch(c.req.raw));
    return finalizeResponse(res, holder.receipt, link, deps.config.publicOrigin);
  });

  return app;
}

type ReceiptHolder = { receipt: ReceiptAny | null };
const receiptStore = new AsyncLocalStorage<ReceiptHolder>();

let mppChallengeStoreSingleton: ChallengeStore | null = null;
function getMppChallengeStore(): ChallengeStore {
  if (!mppChallengeStoreSingleton) {
    mppChallengeStoreSingleton = createInMemoryChallengeStore();
  }
  return mppChallengeStoreSingleton;
}

function settlementTxFromReceipt(r: ReceiptAny): string | null {
  if (isReceiptV02(r) && r.protocol === 'mpp') {
    const s = r.tx_sig ?? r.mpp_settlement_tx;
    return s != null && s.length > 0 ? s : null;
  }
  const t = r.tx_sig;
  return t != null && t.length > 0 ? t : null;
}

/**
 * Stamp `X-Leash-*` headers on a settled response so cross-origin
 * browser buyers can read the canonical seller-side receipt hash + tx
 * sig + agent without parsing the response body. Falls through
 * untouched on 4xx/5xx (the seller never settled — there's no envelope
 * to surface).
 */
function finalizeResponse(
  res: Response,
  receipt: ReceiptAny | null,
  link: PaymentLinkRow,
  publicOrigin: string,
): Response {
  if (!receipt || res.status >= 400) return res;
  const envelope = buildLeashEnvelope(receipt, {
    origin: publicOrigin.replace(/\/+$/, ''),
    network: link.network === 'solana-mainnet' ? 'mainnet' : 'devnet',
  });
  const headers = new Headers(res.headers);
  buildLeashHeaders(envelope, headers);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Build a single-route Hono app whose only handler returns the upstream
 * response or configured response template, fronted by x402
 * (`createSeller`) or MPP (`createMppSeller`) middleware.
 */
function buildSellerSubApp(
  deps: PaywallRoutesDeps,
  link: PaymentLinkRow,
  mppFeePayer?: string,
): Hono {
  const sub = new Hono();
  const umi = umiReadOnly(deps.config, link.network);

  if (link.protocol === 'mpp') {
    if (!mppFeePayer) {
      throw new Error('MPP paywall requires fee payer pubkey');
    }
    createMppSeller(sub, {
      umi,
      sellerAgent: { asset: link.ownerAgent },
      routes: {
        [`${link.method} ${link.path}`]: {
          description: link.label,
          price: link.price,
          currency: link.currency,
          mimeType: link.response.mimeType,
        },
      },
      network: link.network,
      facilitator: facilitatorForNetwork(deps.config, link.network),
      feePayerAddress: mppFeePayer,
      challengeStore: getMppChallengeStore(),
      onReceipt: async (receipt) => {
        const holder = receiptStore.getStore();
        if (holder) holder.receipt = receipt;
        await ingestPaywallReceipt(deps, link, receipt);
      },
    });
  } else {
    createSeller(sub, {
      umi,
      sellerAgent: { asset: link.ownerAgent },
      routes: {
        [`${link.method} ${link.path}`]: {
          description: link.label,
          price: link.price,
          currency: link.currency,
          acceptsCurrencies: link.acceptsCurrencies,
          mimeType: link.response.mimeType,
        },
      },
      network: link.network,
      facilitator: facilitatorForNetwork(deps.config, link.network),
      onReceipt: async (receipt) => {
        const holder = receiptStore.getStore();
        if (holder) holder.receipt = receipt;
        await ingestPaywallReceipt(deps, link, receipt);
      },
    });
  }

  sub.on(link.method, link.path, (c) => settledPaymentLinkResponse(link, c.req.raw));
  return sub;
}

export async function settledPaymentLinkResponse(
  link: PaymentLinkRow,
  req: Request,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> {
  const upstreamUrl = upstreamUrlFromMetadata(link.metadata);
  if (!upstreamUrl) return templateResponse(link);

  let target: URL;
  try {
    target = new URL(upstreamUrl);
  } catch {
    return upstreamError('invalid upstream_url configured on payment link', 502);
  }

  const incoming = new URL(req.url);
  for (const [key, value] of incoming.searchParams) {
    if (key === 'network') continue;
    target.searchParams.append(key, value);
  }

  try {
    const upstream = await fetchImpl(target, {
      method: link.method,
      headers: forwardedHeaders(req.headers),
      body: methodCanHaveBody(link.method) ? req.body : undefined,
      redirect: 'manual',
      // Required by Node fetch when forwarding a ReadableStream body.
      ...(methodCanHaveBody(link.method) ? { duplex: 'half' as const } : {}),
    });
    return sanitizeUpstreamResponse(upstream);
  } catch (err) {
    return upstreamError(err instanceof Error ? err.message : 'upstream request failed', 502);
  }
}

function templateResponse(link: PaymentLinkRow): Response {
  const r = link.response;
  const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  return new Response(body, {
    status: r.status,
    headers: { 'content-type': r.mimeType },
  });
}

function upstreamUrlFromMetadata(metadata: Record<string, unknown>): string | null {
  const value = metadata.upstream_url;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return trimmed;
  }
}

function methodCanHaveBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const PAYMENT_HEADERS = new Set([
  'authorization',
  'x-payment',
  'x-leash-callback',
  'payment-required',
  'x-payment-response',
  'payment-response',
]);

function forwardedHeaders(headers: Headers): Headers {
  const next = new Headers();
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || PAYMENT_HEADERS.has(lower)) return;
    next.set(key, value);
  });
  return next;
}

function sanitizeUpstreamResponse(upstream: Response): Response {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    headers.set(key, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function upstreamError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: 'upstream_failed', message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Exported so paywall tests can drive the post-settlement flow without
 * standing up a real x402 facilitator.
 */
export async function ingestPaywallReceipt(
  deps: PaywallRoutesDeps,
  link: PaymentLinkRow,
  receipt: ReceiptAny,
): Promise<void> {
  const network = link.network;
  const txSig = settlementTxFromReceipt(receipt);
  const ingested = await ingestReceipt(deps.db, { network, receipt });

  await recordSettlement(deps.db, {
    network,
    id: link.id,
    txSig,
    amountAtomic: receipt.price?.amount ?? null,
    currency: receipt.price?.currency ?? null,
  });

  // Best-effort enroll the agent in the indexer watchlist so any
  // on-chain follow-up (treasury withdraw etc) shows up in the
  // explorer feed for this agent as well.
  try {
    const umi = umiReadOnly(deps.config, network);
    const [treasury] = findAssetSignerPda(umi, { asset: publicKey(link.ownerAgent) });
    await ensureWatched(deps.db, {
      network,
      agentAsset: link.ownerAgent,
      treasuryAddress: String(treasury),
    });
  } catch {
    /* never fail a paid call on watchlist add */
  }

  if (!ingested.duplicate) {
    const receiptEventId = await createPreparedEvent(deps.db, {
      kind: 'receipt.published',
      network,
      apiKeyId: link.apiKeyId,
      agentAsset: link.ownerAgent,
      metadata: {
        receipt_hash: receipt.receipt_hash,
        ...(txSig ? { tx_sig: txSig } : {}),
      },
    });
    if (txSig) await markSubmitted(deps.db, receiptEventId, txSig);
    await markConfirmed(deps.db, receiptEventId);
  }

  const servedId = await createPreparedEvent(deps.db, {
    kind: 'payment_link.served',
    network,
    apiKeyId: link.apiKeyId,
    agentAsset: link.ownerAgent,
    metadata: { payment_link_id: link.id, tx_sig: txSig },
  });
  if (txSig) await markSubmitted(deps.db, servedId, txSig);
  await markConfirmed(deps.db, servedId);

  const settledId = await createPreparedEvent(deps.db, {
    kind: 'payment_link.settled',
    network,
    apiKeyId: link.apiKeyId,
    agentAsset: link.ownerAgent,
    mint: receipt.price?.asset ?? null,
    amountAtomic: receipt.price?.amount ?? null,
    metadata: {
      payment_link_id: link.id,
      tx_sig: txSig,
      currency: receipt.price?.currency ?? null,
      receipt_hash: receipt.receipt_hash,
      ...(receipt.price?.fee ? { fee_amount: receipt.price.fee } : {}),
      ...(receipt.price?.gross ? { gross_amount: receipt.price.gross } : {}),
      ...(receipt.price?.feeBps != null ? { fee_bps: receipt.price.feeBps } : {}),
      ...(receipt.price?.feeAuthority ? { fee_authority: receipt.price.feeAuthority } : {}),
    },
  });
  if (txSig) await markSubmitted(deps.db, settledId, txSig);
  await markConfirmed(deps.db, settledId);

  // Mirror the receipt-level fee event so the explorer's "Protocol
  // fees" feed picks up paywall settlements alongside push/pull
  // ingest. Idempotent on (network, receipt_hash).
  await emitProtocolFeeEvent(deps.db, {
    network,
    receipt,
    apiKeyId: link.apiKeyId,
  });
}

function resolveNetwork(raw: string | undefined): SvmNetwork {
  // Default to mainnet — production paywalls are mainnet, devnet
  // links are explicitly opt-in via `?network=solana-devnet`.
  if (!raw) return 'solana-mainnet';
  if (isSvmNetwork(raw)) return raw;
  // Friendly aliases.
  if (raw === 'devnet') return 'solana-devnet';
  if (raw === 'mainnet') return 'solana-mainnet';
  return 'solana-mainnet';
}

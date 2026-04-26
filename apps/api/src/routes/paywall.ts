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
 *      route at `link.method link.path` whose handler returns the
 *      configured response template (status / mimeType / body).
 *   4. Wrap that sub-app with `createSeller(...)` so every request
 *      goes through the real x402 middleware: 402 + paymentRequirements
 *      on first hit, settle + invoke on second hit with `X-PAYMENT`.
 *   5. Forward the original `Request` into the sub-app and return the
 *      sub-app's `Response` verbatim.
 *
 * The seller-kit's `onReceipt` callback fires only on successful
 * settlement. We use it to:
 *   - persist the `ReceiptV1` in our `receipts` table (idempotent on
 *     `receipt_hash`)
 *   - bump `payment_links.settled_count` + record the latest tx sig
 *   - emit `payment_link.served` + `payment_link.settled` events so the
 *     explorer's activity feed and any subscribed webhooks light up.
 *
 * The receipt sink is wired up with `onReceipt: <closure>`, NOT the
 * env-driven runner/api forwarder, because we *are* the API. We also
 * set `LEASH_RECEIPTS_DISABLED` semantics implicitly by passing a
 * direct callback.
 */

import { Hono } from 'hono';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import { createSeller } from '@leash/seller-kit';
import type { ReceiptV1 } from '@leash/schemas';

import type { LeashApiConfig } from '../config.js';
import type { CacheClient } from '../storage/redis.js';
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

  app.all('/x/:id', async (c) => {
    const id = c.req.param('id');
    const network = resolveNetwork(c.req.query('network'));

    const link = await getPaymentLink(deps.db, network, id);
    if (!link) {
      // Try the sibling network so a buyer who shared a devnet link
      // without `?network=devnet` still gets a useful 404 explaining
      // where to find it.
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

    const sellerApp = buildSellerSubApp(deps, link);
    return sellerApp.fetch(c.req.raw);
  });

  return app;
}

/**
 * Build a single-route Hono app whose only handler returns the
 * configured response template, fronted by the real x402 seller-kit
 * middleware. Order matters: Hono `app.use(...)` without a path only
 * runs against routes registered AFTER it, so we install the seller
 * middleware first via `createSeller(...)`, then register our 200
 * response handler.
 */
function buildSellerSubApp(deps: PaywallRoutesDeps, link: PaymentLinkRow): Hono {
  const sub = new Hono();
  const umi = umiReadOnly(deps.config, link.network);
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
    facilitator: deps.config.facilitatorUrl,
    onReceipt: async (receipt) => {
      await ingestPaywallReceipt(deps, link, receipt);
    },
  });
  sub.on(link.method, link.path, () => {
    const r = link.response;
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, {
      status: r.status,
      headers: { 'content-type': r.mimeType },
    });
  });
  return sub;
}

/**
 * Persist a settled `ReceiptV1` and emit the matching event timeline:
 *   1. `ingestReceipt` (idempotent on receipt_hash)
 *   2. `recordSettlement` bumps `settled_count` + last_tx_sig
 *   3. `receipt.published` event for the explorer's receipt feed
 *   4. `payment_link.served` event for the paywall traffic timeline
 *   5. `payment_link.settled` event for revenue dashboards
 *   6. Best-effort indexer watchlist enrollment so the seller's agent
 *      lights up on-chain activity in the explorer too.
 *
 * Exported so paywall tests can drive the post-settlement flow without
 * standing up a real x402 facilitator.
 */
export async function ingestPaywallReceipt(
  deps: PaywallRoutesDeps,
  link: PaymentLinkRow,
  receipt: ReceiptV1,
): Promise<void> {
  const network = link.network;
  const ingested = await ingestReceipt(deps.db, { network, receipt });

  await recordSettlement(deps.db, {
    network,
    id: link.id,
    txSig: receipt.tx_sig,
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
        ...(receipt.tx_sig ? { tx_sig: receipt.tx_sig } : {}),
      },
    });
    if (receipt.tx_sig) await markSubmitted(deps.db, receiptEventId, receipt.tx_sig);
    await markConfirmed(deps.db, receiptEventId);
  }

  const servedId = await createPreparedEvent(deps.db, {
    kind: 'payment_link.served',
    network,
    apiKeyId: link.apiKeyId,
    agentAsset: link.ownerAgent,
    metadata: { payment_link_id: link.id, tx_sig: receipt.tx_sig },
  });
  if (receipt.tx_sig) await markSubmitted(deps.db, servedId, receipt.tx_sig);
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
      tx_sig: receipt.tx_sig,
      currency: receipt.price?.currency ?? null,
      receipt_hash: receipt.receipt_hash,
      // Fee context lets revenue dashboards split gross vs. net without
      // re-deriving from the receipt blob. Optional — vanilla x402
      // settlements (no Leash facilitator) leave these undefined.
      ...(receipt.price?.fee ? { fee_amount: receipt.price.fee } : {}),
      ...(receipt.price?.gross ? { gross_amount: receipt.price.gross } : {}),
      ...(receipt.price?.feeBps != null ? { fee_bps: receipt.price.feeBps } : {}),
      ...(receipt.price?.feeAuthority ? { fee_authority: receipt.price.feeAuthority } : {}),
    },
  });
  if (receipt.tx_sig) await markSubmitted(deps.db, settledId, receipt.tx_sig);
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

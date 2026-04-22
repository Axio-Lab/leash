import type { Hono } from 'hono';
import type { Context as UmiContext } from '@metaplex-foundation/umi';
import type { ReceiptV1 } from '@leash/schemas';
import {
  finalizeReceipt,
  networkFromCaip2,
  paymentRequirementsHash,
  requestHash,
} from '@leash/core';
import { paymentMiddlewareFromHTTPServer } from '@x402/hono';
import { x402HTTPResourceServer } from '@x402/core/server';
import type {
  FacilitatorClient,
  HTTPRequestContext,
  HTTPTransportContext,
  RouteConfig,
} from '@x402/core/server';
import {
  caip2ForSellerNetwork,
  createSvmResourceServer,
  DEFAULT_FACILITATOR_URL,
  type LeashSellerNetwork,
} from '../x402/svm-server.js';
import { resolveSellerPayTo, type AgentSellerConfig } from '../seller/agent-seller.js';
import { parsePrice } from '../receipts/price.js';

export type SellerRouteConfig = {
  description: string;
  /**
   * Display price e.g. `"$0.001"`, `"0.01 USDC"`, or `"0.5"`. Forwarded to
   * `@x402/svm`'s `ExactSvmScheme.parsePrice`, which converts to USDC atomic
   * units on the configured network. The same string is also parsed locally
   * via `parsePrice()` and copied into every `earn` receipt as
   * `{ amount, currency }` so explorers can render it without re-parsing.
   */
  price: string;
  /** Optional MIME type for the response. Defaults to `application/json`. */
  mimeType?: string;
};

export type CreateSellerOptions = {
  umi: Pick<UmiContext, 'eddsa' | 'programs'>;
  sellerAgent: AgentSellerConfig;
  routes: Record<string, SellerRouteConfig>;
  /**
   * CAIP-2 Solana network to settle on. Defaults to `'solana-devnet'`. The
   * same network is stamped onto `ReceiptV1.price.network` and into the
   * `paymentRequirements.network` advertised in 402 responses.
   */
  network?: LeashSellerNetwork;
  /**
   * Hosted x402 facilitator URL, or a pre-built `FacilitatorClient`. Defaults
   * to `https://facilitator.svmacc.tech` (free, gas-sponsored). The URL is
   * also stamped onto `ReceiptV1.facilitator` so consumers can verify the
   * settlement out-of-band.
   */
  facilitator?: string | FacilitatorClient;
  /**
   * Called with every settled `earn` receipt. Receipts only fire on
   * successful x402 settlements (the underlying `onAfterSettle` hook), so a
   * 402 / 4xx / 5xx never produces a (false) earn receipt. Use this to ship
   * receipts to the Leash runner — e.g.
   * `onReceipt: (r) => fetch(`${RUNNER}/a/${r.agent}/receipts`, { method: 'POST', body: JSON.stringify(r) })`.
   * Errors thrown here are swallowed so a runner outage never breaks a
   * paying customer's request.
   */
  onReceipt?: (receipt: ReceiptV1) => void | Promise<void>;
  /** Override the policy version stamped onto receipts. Defaults to `'0.1'`. */
  policyVersion?: string;
};

export type Seller = {
  /** Asset Signer PDA derived from `sellerAgent.asset` — the on-chain `payTo`. */
  payTo: string;
  /** Resolved facilitator URL written to receipts (null if a custom client was passed). */
  facilitatorUrl: string | null;
  /** CAIP-2 network the seller settles on. */
  network: string;
};

type SellerState = {
  nonce: number;
  prevReceiptHash: string | null;
};

/**
 * Wires real x402-on-Solana payment enforcement onto a Hono app. For each
 * route entry (`'METHOD /path'`), 402 responses include a proper
 * `paymentRequirements[]` JSON; clients (e.g. `@leash/buyer-kit` or any
 * `@x402/fetch` consumer) sign an SPL `TransferChecked` to the agent's
 * Asset Signer PDA and replay the request with `X-PAYMENT`. The configured
 * facilitator verifies + settles the transaction on-chain, and `onReceipt`
 * is invoked with a tamper-evident `earn` `ReceiptV1` populated with the
 * real Solana transaction signature.
 */
export function createSeller(app: Hono, opts: CreateSellerOptions): Seller {
  const payTo = resolveSellerPayTo(opts.umi, opts.sellerAgent);
  const agent = String(opts.sellerAgent.asset);
  const policyVersion = opts.policyVersion ?? '0.1';
  const sellerNetwork: LeashSellerNetwork = opts.network ?? 'solana-devnet';
  const networkCaip2 = caip2ForSellerNetwork(sellerNetwork);
  const state: SellerState = { nonce: 0, prevReceiptHash: null };

  const { server, facilitatorUrl } = createSvmResourceServer({
    networks: [sellerNetwork],
    facilitator: opts.facilitator ?? DEFAULT_FACILITATOR_URL,
  });

  const recordedFacilitator =
    typeof opts.facilitator === 'string'
      ? opts.facilitator
      : (facilitatorUrl ?? DEFAULT_FACILITATOR_URL);

  const routes: Record<string, RouteConfig> = {};
  for (const [routeKey, cfg] of Object.entries(opts.routes)) {
    const [method, path] = routeKey.split(/\s+/, 2);
    if (!method || !path) {
      throw new Error(`Invalid route key: ${routeKey}`);
    }
    routes[`${method.toUpperCase()} ${path}`] = {
      description: cfg.description,
      mimeType: cfg.mimeType ?? 'application/json',
      accepts: {
        scheme: 'exact',
        network: networkCaip2,
        payTo,
        price: cfg.price,
      },
    };
  }

  const httpServer = new x402HTTPResourceServer(server, routes);

  /**
   * `onAfterSettle` fires once the facilitator has confirmed the SPL
   * transfer. The `result.transaction` is the real Solana signature.
   */
  server.onAfterSettle(async ({ requirements, result, transportContext }) => {
    if (!result.success) return;
    const httpCtx = transportContext as HTTPTransportContext | undefined;
    const reqCtx: HTTPRequestContext | undefined = httpCtx?.request;
    const method = reqCtx?.method ?? 'POST';
    const url = reqCtx?.adapter.getUrl?.() ?? reqCtx?.path ?? '';
    const route = findRouteForPath(opts.routes, reqCtx);
    const price = route ? parsePrice(route.price) : null;
    const enrichedPrice = price
      ? {
          ...price,
          network: networkFromCaip2(networkCaip2) ?? sellerNetwork,
          asset: requirements.asset,
        }
      : null;
    await emitEarnReceipt({
      state,
      agent,
      policyVersion,
      method,
      url,
      bodyText: null,
      responseStatus: 200,
      txSig: result.transaction ?? null,
      facilitator: recordedFacilitator,
      paymentReqHash: paymentRequirementsHash(requirements),
      price: enrichedPrice,
      onReceipt: opts.onReceipt,
    });
  });

  app.use(paymentMiddlewareFromHTTPServer(httpServer));

  return { payTo, facilitatorUrl: recordedFacilitator, network: networkCaip2 };
}

/**
 * Find the user-supplied SellerRouteConfig that matches a verified payment.
 * Matches `'METHOD /path'` keys against the live request context; falls back
 * to the first entry so single-route sellers always resolve correctly.
 */
function findRouteForPath(
  routes: Record<string, SellerRouteConfig>,
  reqCtx: HTTPRequestContext | undefined,
): SellerRouteConfig | null {
  if (reqCtx) {
    const path = reqCtx.path;
    const method = reqCtx.method.toUpperCase();
    for (const [key, cfg] of Object.entries(routes)) {
      const [m, p] = key.split(/\s+/, 2);
      if (m && p && m.toUpperCase() === method && p === path) return cfg;
    }
  }
  const first = Object.values(routes)[0];
  return first ?? null;
}

async function emitEarnReceipt(args: {
  state: SellerState;
  agent: string;
  policyVersion: string;
  method: string;
  url: string;
  bodyText: string | null;
  responseStatus: number;
  txSig: string | null;
  facilitator: string;
  paymentReqHash: string | null;
  price: ReceiptV1['price'];
  onReceipt: CreateSellerOptions['onReceipt'];
}): Promise<void> {
  if (!args.onReceipt) return;
  const draft = {
    v: '0.1' as const,
    kind: 'earn' as const,
    agent: args.agent,
    nonce: args.state.nonce,
    ts: new Date().toISOString(),
    policy_v: args.policyVersion,
    request: {
      method: args.method,
      url: args.url,
      body_hash: args.bodyText
        ? requestHash({ method: args.method, url: args.url, body: args.bodyText })
        : null,
    },
    decision: 'allow' as const,
    reason: null,
    price: args.price,
    facilitator: args.facilitator,
    tx_sig: args.txSig,
    payment_requirements_hash: args.paymentReqHash,
    response: { status: args.responseStatus, body_hash: null },
    prev_receipt_hash: args.state.prevReceiptHash,
  };
  const receipt = finalizeReceipt(draft);
  args.state.nonce += 1;
  args.state.prevReceiptHash = receipt.receipt_hash;
  try {
    await args.onReceipt(receipt);
  } catch {
    // Intentionally swallowed: a runner outage must not surface as a paying
    // customer's HTTP error.
  }
}

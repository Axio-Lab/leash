import type { Hono } from 'hono';
import type { Context as UmiContext } from '@metaplex-foundation/umi';
import type { ReceiptV1 } from '@leash/schemas';
import {
  buildLeashFeeExtra,
  computeFeeAtoms as computeFeeAtomsHelper,
  finalizeReceipt,
  KNOWN_STABLE_SYMBOLS,
  lookupTokenBySymbol,
  networkFromCaip2,
  parseLeashFeeExtra,
  paymentRequirementsHash,
  requestHash,
  type KnownStableSymbol,
  type LeashFeeExtra,
  type TokenNetwork,
} from '@leash/core';
import { paymentMiddlewareFromHTTPServer } from '@x402/hono';
import { x402HTTPResourceServer } from '@x402/core/server';
import type {
  FacilitatorClient,
  HTTPRequestContext,
  HTTPTransportContext,
  RouteConfig,
} from '@x402/core/server';
import type { PaymentOption } from '@x402/core/http';
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
   * Display price e.g. `"$0.001"`, `"0.01 USDC"`, or `"0.5"`. Parsed locally
   * via {@link parsePrice} into atomic units against the route's `currency`
   * (defaults to `'USDC'`), then advertised on the wire as an
   * `AssetAmount` payment option so the facilitator settles in exactly that
   * stablecoin. The same parsed `{ amount, currency, asset }` is stamped onto
   * every `earn` `ReceiptV1` so explorers can render the correct value
   * without re-parsing.
   */
  price: string;
  /**
   * Settlement currency for the price. Must be a Leash-known stablecoin
   * (`USDC` / `USDT` / `USDG`) so the seller-kit can resolve a real mint via
   * `@leash/core/tokens`. Defaults to `'USDC'`.
   */
  currency?: KnownStableSymbol;
  /**
   * Additional stablecoins this route also accepts. When set, the runner
   * advertises an `accepts[]` of equivalent payment options (same dollar
   * amount across each stable, since v0.1 treats them as 1:1 USD pegs) so a
   * paying agent can choose which token to debit. The route's primary
   * `currency` is always included implicitly.
   */
  acceptsCurrencies?: KnownStableSymbol[];
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
   *
   * Pass `false` to explicitly disable receipt publishing, even if env-
   * level defaults (LEASH_RUNNER_URL / LEASH_API_URL) are configured.
   */
  onReceipt?: ((receipt: ReceiptV1) => void | Promise<void>) | false;
  /**
   * Optional fan-out destinations applied when `onReceipt` is undefined.
   * Either or both can be set; `process.env.LEASH_RUNNER_URL`,
   * `LEASH_API_URL`, and `LEASH_API_KEY` are also read so the most
   * common production setup needs zero seller-kit code changes.
   * Setting `LEASH_RECEIPTS_DISABLED=1` is the global kill switch.
   */
  receipts?: SellerReceiptForwardConfig;
  /** Override the policy version stamped onto receipts. Defaults to `'0.1'`. */
  policyVersion?: string;
};

export type SellerReceiptForwardConfig = {
  runnerUrl?: string;
  apiUrl?: string;
  apiKey?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
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
  // Same precedence as buyer-kit: explicit `false` => off, function =>
  // user controls the sink, undefined => env + opts fan-out.
  const receiptSink = resolveSellerReceiptSink(opts.onReceipt, opts.receipts);

  const { server, facilitatorUrl } = createSvmResourceServer({
    networks: [sellerNetwork],
    facilitator: opts.facilitator ?? DEFAULT_FACILITATOR_URL,
  });

  const recordedFacilitator =
    typeof opts.facilitator === 'string'
      ? opts.facilitator
      : (facilitatorUrl ?? DEFAULT_FACILITATOR_URL);

  const tokenNetwork: TokenNetwork =
    networkAliasFor(sellerNetwork) === 'solana-mainnet' ? 'mainnet' : 'devnet';

  const routes: Record<string, RouteConfig> = {};
  for (const [routeKey, cfg] of Object.entries(opts.routes)) {
    const [method, path] = routeKey.split(/\s+/, 2);
    if (!method || !path) {
      throw new Error(`Invalid route key: ${routeKey}`);
    }
    const accepts = buildAccepts({
      payTo,
      networkCaip2,
      tokenNetwork,
      priceString: cfg.price,
      currency: cfg.currency ?? 'USDC',
      extraCurrencies: cfg.acceptsCurrencies ?? [],
    });
    routes[`${method.toUpperCase()} ${path}`] = {
      description: cfg.description,
      mimeType: cfg.mimeType ?? 'application/json',
      accepts: accepts.length === 1 ? accepts[0] : accepts,
    };
  }

  const httpServer = new x402HTTPResourceServer(server, routes);

  /**
   * `onAfterSettle` fires once the facilitator has confirmed the SPL
   * transfer. The `result.transaction` is the real Solana signature.
   *
   * The receipt's `price` is sourced from the **settled** payment
   * requirements (so multi-currency endpoints stamp the actual debited
   * token), then enriched with the friendly Leash network slug.
   *
   * We additionally stamp `result.paymentRequirements = requirements`
   * BEFORE the x402 middleware encodes `PAYMENT-RESPONSE`. Why: the
   * upstream x402 SDK only puts the settlement `transaction` (and
   * payer / network / amount) into the response header, not the
   * matched `PaymentRequirements`. That leaves any buyer reading the
   * header — including our own buyer-kit's `parseSettlement` — unable
   * to recover the price/asset and forces them to stamp `price: null`
   * on the spend receipt. Mutating `result` here lets the encoder
   * pick up the requirements via JSON spread (the field rides along
   * inside the same base64 payload), and `parseSettlement` already
   * looks for `obj.paymentRequirements` on the decoded side, so the
   * fix is end-to-end with zero changes on the buyer.
   *
   * We also fan into `extensions['leash.paymentRequirements']` as a
   * second carrier for future buyers that prefer the namespaced
   * extension surface (per x402's extension contract).
   */
  server.onAfterSettle(async ({ requirements, result, transportContext }) => {
    if (!result.success) return;
    // Cast through `unknown` because `SettleResponse` doesn't declare
    // `paymentRequirements` in its type but the JSON encoder is
    // permissive — extra fields round-trip cleanly.
    (result as unknown as { paymentRequirements: typeof requirements }).paymentRequirements =
      requirements;
    const extensions = (result.extensions ?? {}) as Record<string, unknown>;
    extensions['leash.paymentRequirements'] = requirements;
    result.extensions = extensions;
    const httpCtx = transportContext as HTTPTransportContext | undefined;
    const reqCtx: HTTPRequestContext | undefined = httpCtx?.request;
    const method = reqCtx?.method ?? 'POST';
    const url = reqCtx?.adapter.getUrl?.() ?? reqCtx?.path ?? '';
    const route = findRouteForPath(opts.routes, reqCtx);
    const settledCurrency =
      lookupTokenBySymbol('USDC', tokenNetwork)?.mint === requirements.asset
        ? 'USDC'
        : (lookupCurrencyBySymbol(requirements.asset, tokenNetwork) ?? route?.currency ?? 'USDC');
    // Enrich the receipt's price with protocol-fee context when the
    // settled requirements carry an `extra['leash.fee']` block. We
    // compute the atomic fee + gross from the seller's net amount + bps
    // (same logic as the buyer scheme + facilitator), so explorers can
    // render `gross / fee / net` without re-deriving anything. Vanilla
    // x402 settlements (no fee block) keep the slim shape.
    const feeExtra = parseLeashFeeExtra(
      (requirements.extra ?? null) as Record<string, unknown> | null,
    );
    const netAtomic = BigInt(requirements.amount);
    const feeAtomic = feeExtra ? computeFeeAtomsHelper(netAtomic, feeExtra.bps) : 0n;
    const grossAtomic = netAtomic + feeAtomic;
    const enrichedPrice: ReceiptV1['price'] = {
      amount: requirements.amount,
      currency: settledCurrency,
      network: networkFromCaip2(networkCaip2) ?? sellerNetwork,
      asset: requirements.asset,
      ...(feeExtra
        ? {
            fee: feeAtomic.toString(),
            gross: grossAtomic.toString(),
            feeBps: feeExtra.bps,
            feeAuthority: feeExtra.feeAuthority,
          }
        : {}),
    };
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
      sink: receiptSink,
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

/**
 * Build the x402 `accepts[]` payment options for a route. The primary
 * `currency` always comes first; any `extraCurrencies` are appended at
 * the same dollar-equivalent amount (1:1 USD assumption is fine for v0.1
 * since we only support 6-dec USD-pegged stables in the registry).
 *
 * Each option is encoded as an `AssetAmount` so the facilitator settles
 * in exactly the buyer-chosen mint — no implicit USDC fallback.
 */
function buildAccepts(args: {
  payTo: string;
  networkCaip2: string;
  tokenNetwork: TokenNetwork;
  priceString: string;
  currency: KnownStableSymbol;
  extraCurrencies: KnownStableSymbol[];
}): PaymentOption[] {
  const all = uniq<KnownStableSymbol>([args.currency, ...args.extraCurrencies]);
  // One-shot fee descriptor reused across every accepts[] entry. Bps +
  // authority are the same for the whole route — only the destination
  // ATA differs per asset, and that's derived buyer/facilitator-side
  // from `(asset, tokenProgram, authority)` so it never lives on the
  // wire.
  const leashFee: LeashFeeExtra = buildLeashFeeExtra({ network: args.tokenNetwork });
  return all.map((currency) => {
    const parsed = parsePrice(args.priceString, {
      network: args.tokenNetwork,
      defaultCurrency: currency,
    });
    if (!parsed) {
      throw new Error(
        `Invalid price "${args.priceString}" for currency ${currency} on ${args.tokenNetwork}.`,
      );
    }
    // `extra['leash.fee']` rides along inside the `AssetAmount.extra`
    // bag and surfaces on `paymentRequirements.extra` at 402 time. The
    // x402 SDK forwards arbitrary extras through verbatim, so the
    // buyer-kit / facilitator can read it without touching this layer.
    return {
      scheme: 'exact',
      network: args.networkCaip2 as PaymentOption['network'],
      payTo: args.payTo,
      price: { asset: parsed.asset!, amount: parsed.amount, extra: { 'leash.fee': leashFee } },
    };
  });
}

function uniq<T>(arr: ReadonlyArray<T>): T[] {
  return Array.from(new Set(arr));
}

/** Reverse-resolve a stablecoin symbol from a settled mint, if known. */
function lookupCurrencyBySymbol(asset: string, network: TokenNetwork): KnownStableSymbol | null {
  for (const sym of KNOWN_STABLE_SYMBOLS) {
    if (lookupTokenBySymbol(sym, network)?.mint === asset) return sym;
  }
  return null;
}

/**
 * v0.1 collapses `solana-testnet` → `solana-devnet` for the token registry
 * lookup. Mirrors {@link networkAlias} from `../x402/svm-server.ts` but
 * exists locally to avoid a circular import in barrel files.
 */
function networkAliasFor(net: LeashSellerNetwork): 'solana-mainnet' | 'solana-devnet' {
  return net === 'solana-mainnet' ? 'solana-mainnet' : 'solana-devnet';
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
  sink: (receipt: ReceiptV1) => Promise<void>;
}): Promise<void> {
  // The sink is always callable; it short-circuits internally when the
  // user passed `onReceipt: false` or `LEASH_RECEIPTS_DISABLED=1`.
  // We still build the receipt in that case so the chain (`prev_receipt_hash`)
  // stays consistent across calls — disabling publishing must not mutate
  // the receipt graph.
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
  await args.sink(receipt);
}

/**
 * Resolver shared with `@leash/buyer-kit`. Lives here as a small inline
 * copy (instead of importing from buyer-kit) so the seller package stays
 * server-only and doesn't pull in the buyer's `@solana/kit` dependency.
 */
export function resolveSellerReceiptSink(
  onReceipt: CreateSellerOptions['onReceipt'],
  forward: SellerReceiptForwardConfig | undefined,
): (receipt: ReceiptV1) => Promise<void> {
  if (onReceipt === false || envFlag('LEASH_RECEIPTS_DISABLED')) {
    return async () => {};
  }
  if (typeof onReceipt === 'function') {
    return async (receipt) => {
      try {
        await onReceipt(receipt);
      } catch {
        // Intentionally swallowed.
      }
    };
  }
  const env = readEnvForwardConfig();
  const merged: SellerReceiptForwardConfig = {
    runnerUrl: forward?.runnerUrl ?? env.runnerUrl,
    apiUrl: forward?.apiUrl ?? env.apiUrl,
    apiKey: forward?.apiKey ?? env.apiKey,
    ...(forward?.fetch ? { fetch: forward.fetch } : {}),
  };
  const fetchImpl = merged.fetch ?? globalThis.fetch;
  return async (receipt) => {
    const tasks: Promise<unknown>[] = [];
    if (merged.runnerUrl) {
      tasks.push(
        doPost(
          fetchImpl,
          `${merged.runnerUrl.replace(/\/+$/, '')}/a/${encodeURIComponent(receipt.agent)}/receipts`,
          receipt,
        ),
      );
    }
    if (merged.apiUrl && merged.apiKey) {
      tasks.push(
        doPost(
          fetchImpl,
          `${merged.apiUrl.replace(/\/+$/, '')}/v1/receipts/${encodeURIComponent(receipt.agent)}`,
          receipt,
          { authorization: `Bearer ${merged.apiKey}` },
        ),
      );
    }
    if (tasks.length === 0) return;
    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
      if (r.status === 'rejected') {
        // eslint-disable-next-line no-console
        console.warn('[seller-kit] receipt forward failed:', (r.reason as Error).message);
      }
    }
  };
}

async function doPost(
  fetchImpl: NonNullable<SellerReceiptForwardConfig['fetch']>,
  url: string,
  receipt: ReceiptV1,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(receipt),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`POST ${url} -> ${res.status}: ${detail.slice(0, 200)}`);
  }
}

function readEnvForwardConfig(): SellerReceiptForwardConfig {
  if (typeof process === 'undefined' || !process.env) return {};
  const env = process.env;
  return {
    ...(env.LEASH_RUNNER_URL ? { runnerUrl: env.LEASH_RUNNER_URL } : {}),
    ...(env.LEASH_API_URL ? { apiUrl: env.LEASH_API_URL } : {}),
    ...(env.LEASH_API_KEY ? { apiKey: env.LEASH_API_KEY } : {}),
  };
}

function envFlag(name: string): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const raw = process.env[name];
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

import type { ReceiptV1, RulesV1 } from '@leash/schemas';
import {
  createSvmBuyerFetch,
  decodePaymentResponseHeader,
  defaultFacilitatorFor,
  evaluate,
  finalizeReceipt,
  networkFromCaip2,
  paymentRequirementsHash,
  requestHash,
  type ClientSvmSigner,
  type LeashFetch,
  type LeashX402Network,
  type PaymentRequirements,
  type PolicyState,
} from '@leash/core';

export type BuyerConfig = {
  agent: string;
  rules: RulesV1;
  /** Initial spent today (decimal string). */
  spentToday?: string;
  /**
   * `@solana/kit` `TransactionSigner` used to sign x402 SPL token transfers.
   * On Node, build it via `createKeyPairSignerFromBytes(secret) via @solana/kit`. In the
   * browser, use the Privy → kit adapter (`apps/web/lib/privy-x402-signer.ts`).
   */
  signer: ClientSvmSigner;
  /**
   * Solana clusters to register on the underlying x402Client. The buyer will
   * pay against any `paymentRequirements` whose network matches one of these.
   * Defaults to `['solana-devnet']` so dev runs never accidentally touch
   * mainnet USDC.
   */
  networks?: LeashX402Network[];
  /** Optional custom RPC URL passed to `ExactSvmScheme`. */
  rpcUrl?: string;
  /**
   * If set, payments use the Leash delegate scheme instead of the default
   * `ExactSvmScheme`: funds debit from this token account (e.g. an agent
   * treasury PDA's USDC ATA) and `signer` signs as the SPL **delegate** of
   * that account. The owner of the account must have previously approved
   * `signer.address` for at least the per-call price (see
   * `setSpendDelegation` in `@leash/registry-utils`).
   *
   * Leave undefined for vanilla "signer pays from their own ATA" flow.
   */
  sourceTokenAccount?: string;
  /**
   * Facilitator label/URL written to receipts. The buyer never talks to the
   * facilitator directly — the seller does — but recording it on the receipt
   * lets explorers double-check settlement out-of-band. Defaults to
   * `'https://facilitator.svmacc.tech'` to match `@leash/seller-kit`'s default.
   */
  facilitator?: string;
  /**
   * Called with every finalized receipt (allowed and denied). Use this to
   * ship receipts to the Leash runner — e.g.
   * `onReceipt: (r) => fetch(`${RUNNER}/a/${r.agent}/receipts`, { method: 'POST', body: JSON.stringify(r) })`.
   * Errors thrown here are swallowed so a runner outage never breaks a buyer call.
   */
  onReceipt?: (receipt: ReceiptV1) => void | Promise<void>;
  /**
   * Optional `fetch` override (defaults to a payment-wrapped `globalThis.fetch`).
   * Pass a pre-built one when you've already constructed the x402 client (e.g.
   * for testing with a mock facilitator).
   */
  fetch?: LeashFetch;
};

export type BuyerCallResult = {
  response: Response;
  receipt: ReceiptV1;
  /**
   * The price the seller actually demanded (decoded from the `payment-required`
   * header). Present whenever the seller returned 402, regardless of whether
   * settlement succeeded. Useful for the UI to say "tried to pay 5 USDC but…".
   */
  quotedPrice?: ReceiptV1['price'];
  /**
   * Human-readable reason the call did not settle. Sourced from the seller's
   * `payment-required` header `error` field on 402s where no
   * `PAYMENT-RESPONSE` came back. `undefined` on successful settlement.
   */
  failureReason?: string;
};

export type Buyer = {
  fetch(url: string, init?: RequestInit): Promise<BuyerCallResult>;
};

// Imported from @leash/core. Re-resolved on every createBuyer call so the
// LEASH_FACILITATOR_URL env override applies even when buyer-kit is bundled
// without process polyfills (the helper guards `typeof process`).

/**
 * Build a Leash buyer agent. The returned `fetch` enforces the policy
 * (`RulesV1`) before paying, then delegates to a real x402-on-Solana fetch
 * (`@x402/fetch` + `ExactSvmScheme`). On every call (paid or denied) it
 * emits a tamper-evident `ReceiptV1` via `onReceipt` so receipts land in
 * the explorer.
 */
export function createBuyer(cfg: BuyerConfig): Buyer {
  const networks = cfg.networks ?? (['solana-devnet'] as LeashX402Network[]);
  const facilitator = cfg.facilitator ?? defaultFacilitatorFor(networks);
  const paidFetch =
    cfg.fetch ??
    createSvmBuyerFetch({
      signer: cfg.signer,
      networks,
      ...(cfg.rpcUrl ? { rpcUrl: cfg.rpcUrl } : {}),
      ...(cfg.sourceTokenAccount ? { sourceTokenAccount: cfg.sourceTokenAccount } : {}),
    });

  const state: PolicyState = {
    rules: cfg.rules,
    spentToday: cfg.spentToday ?? '0',
    recentRequestHashes: [],
  };

  return {
    async fetch(url, init): Promise<BuyerCallResult> {
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body != null ? String(init.body) : null;
      const h = requestHash({ method, url, body });
      const pol = evaluate(
        { method, url, requestHash: h, estimatedPrice: cfg.rules.budget.perCall },
        cfg.rules,
        state,
      );
      if (pol.decision === 'deny') {
        const draft = {
          v: '0.1' as const,
          kind: 'spend' as const,
          agent: cfg.agent,
          nonce: state.recentRequestHashes.length,
          ts: new Date().toISOString(),
          policy_v: cfg.rules.v,
          request: { method, url, body_hash: body ? requestHash({ method, url, body }) : null },
          decision: 'deny' as const,
          reason: pol.reason ?? 'deny',
          price: null,
          facilitator: null,
          tx_sig: null,
          response: null,
          prev_receipt_hash: null,
        };
        const receipt = finalizeReceipt(draft);
        await emitReceipt(cfg.onReceipt, receipt);
        return {
          response: new Response(JSON.stringify({ error: pol.reason }), { status: 403 }),
          receipt,
        };
      }

      // Run the (payment-wrapped) fetch but never let a transport-layer
      // exception bubble up as an unhandled rejection — we always want to
      // emit a receipt that records *why* the call failed. Common causes:
      //   - Privy popup was cancelled (`wallet_signing_rejected`)
      //   - Facilitator returned a non-2xx response while settling
      //   - RPC is unreachable / rate-limited
      //   - `Response.error()` produced by `@x402/fetch` on bad headers
      let response: Response;
      let networkError: string | null = null;
      try {
        response = await paidFetch(url, init);
      } catch (err) {
        networkError = err instanceof Error ? err.message : String(err);
        // Synthesize a Response so callers always see a uniform shape.
        response = new Response(JSON.stringify({ error: networkError }), {
          status: 0,
          statusText: 'Network error',
        });
      }
      state.recentRequestHashes.push(h);

      // Try header-based settlement first, then fall back to mining
      // `?leash_tx=…&leash_receipt=…&leash_agent=…` query params off
      // `response.url`. The Leash seller-kit doesn't produce those today
      // (the legacy 303-redirect hook was removed), but the URL fallback
      // stays in place as defensive code in case a buyer-side proxy ever
      // re-attaches them after eating the X-Leash-* headers.
      const settlement = parseSettlement(response) ?? parseRedirectSettlement(response);
      // `Response.error()` surfaces as `status: 0` AND `type === 'error'`.
      // **Opaque redirects** also surface as `status: 0` — but they mean the
      // request actually succeeded; the browser just stripped headers because
      // the caller asked for `redirect: 'manual'`. We MUST NOT classify
      // those as network failures, otherwise users see "request never reached
      // the seller" even though their USDC was debited.
      const isOpaqueRedirect =
        response.type === 'opaqueredirect' || (response.status === 0 && response.redirected);
      if (!networkError && response.status === 0 && !isOpaqueRedirect) {
        networkError =
          'Network error — the request did not reach the seller. The signer popup was likely cancelled, or the facilitator/RPC was unreachable.';
      }
      // Suppress the synthetic message if we now know it was a successful
      // opaque redirect (our earlier branch may have set a generic string).
      if (isOpaqueRedirect) networkError = null;

      // If the seller returned 402, decode its `payment-required` header so we
      // can record what was actually demanded and *why* it didn't settle.
      // We need to .clone() because callers will still want to read the body.
      const quote =
        response.status === 402 && !settlement
          ? await parsePaymentRequired(response.clone(), networks)
          : null;

      const failureReason = settlement ? null : (quote?.error ?? networkError ?? null);

      // The call **was** rejected if the policy gate let it through but the
      // request itself failed: 402 with no PAYMENT-RESPONSE (settlement
      // didn't happen), any 4xx/5xx, or a transport-layer error. A 2xx with
      // no payment header is a legitimate "the seller didn't gate this
      // route" success — those stay `allow`. We surface this in the
      // `decision` field so explorers can colour failed receipts red
      // without introspecting `tx_sig === null`.
      const settled = settlement?.txSig != null && settlement.txSig.length > 0;
      const callFailed =
        networkError != null || response.status === 402 || (response.status >= 400 && !settled);
      const decision: 'allow' | 'rejected' = callFailed ? 'rejected' : 'allow';

      const draft = {
        v: '0.1' as const,
        kind: 'spend' as const,
        agent: cfg.agent,
        nonce: state.recentRequestHashes.length - 1,
        ts: new Date().toISOString(),
        policy_v: cfg.rules.v,
        request: { method, url, body_hash: body ? requestHash({ method, url, body }) : null },
        decision,
        // Surface the seller / facilitator / network error verbatim so
        // receipts carry a usable failure reason ("insufficient_funds",
        // "facilitator_error", "Network error — …") instead of a silent
        // null.
        reason: failureReason,
        // Order of precedence:
        //   1. Settled price (truth)                   ← from PAYMENT-RESPONSE
        //   2. Seller-quoted price on a failed 402     ← from payment-required
        //   3. null (we never made a quote-able call)
        // Falling back to `rules.budget.perCall` (the previous behaviour) was a
        // bug — it stamped the policy ceiling on the receipt as if it were the
        // demanded price.
        price: settlement?.price ?? quote?.price ?? null,
        facilitator,
        tx_sig: settlement?.txSig ?? null,
        payment_requirements_hash: settlement?.requirementsHash ?? quote?.requirementsHash ?? null,
        response: { status: response.status, body_hash: null },
        prev_receipt_hash: null,
      };
      const receipt = finalizeReceipt(draft);
      await emitReceipt(cfg.onReceipt, receipt);
      return {
        response,
        receipt,
        quotedPrice: quote?.price,
        failureReason: failureReason ?? undefined,
      };
    },
  };
}

type Settlement = {
  txSig: string | null;
  price: ReceiptV1['price'];
  requirementsHash: string | null;
};

/**
 * Pull the real Solana signature and matched `paymentRequirements` out of the
 * `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE` header that the seller sets after
 * the facilitator settles. We try v2 (`PAYMENT-RESPONSE`) first, then v1.
 */
function parseSettlement(response: Response): Settlement | null {
  const header =
    response.headers.get('PAYMENT-RESPONSE') ??
    response.headers.get('X-PAYMENT-RESPONSE') ??
    response.headers.get('payment-response');
  if (!header) return null;
  let decoded: unknown;
  try {
    decoded = decodePaymentResponseHeader(header);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object') return null;
  const obj = decoded as {
    transaction?: string;
    paymentRequirements?: PaymentRequirements;
  };
  const txSig =
    typeof obj.transaction === 'string' && obj.transaction.length > 0 ? obj.transaction : null;
  const requirements = obj.paymentRequirements ?? null;
  const requirementsHash = paymentRequirementsHash(requirements);
  const price: ReceiptV1['price'] = requirements
    ? {
        amount: requirements.amount,
        currency: 'USDC',
        network: networkFromCaip2(requirements.network) ?? requirements.network,
        asset: requirements.asset,
      }
    : null;
  return { txSig, price, requirementsHash };
}

type Quote = {
  price: ReceiptV1['price'];
  requirementsHash: string | null;
  error: string | null;
};

/**
 * Decode the seller's `payment-required` header on a failed 402 so we can
 * record the *actual* demanded price and any facilitator-side error (e.g.
 * `insufficient_funds`) on the receipt.
 *
 * The header is the base64url-encoded JSON of `PaymentRequired` per x402 v2.
 * If the seller also returned a JSON error body (e.g.
 * `{ "error": "..." }`), we prefer the body's message because facilitator
 * errors land there after a failed `processSettlement`.
 *
 * Picks the first `accepts[i]` whose `network` matches one we're configured to
 * pay on (so we report the price the buyer would have actually attempted, not
 * an entry on a chain we wouldn't touch).
 */
async function parsePaymentRequired(
  response: Response,
  networks: LeashX402Network[],
): Promise<Quote | null> {
  let headerError: string | null = null;
  let bodyError: string | null = null;
  let chosen: PaymentRequirements | null = null;

  const header =
    response.headers.get('payment-required') ?? response.headers.get('PAYMENT-REQUIRED');
  if (header) {
    try {
      const decoded = decodeBase64Json(header) as {
        error?: string;
        accepts?: PaymentRequirements[];
      } | null;
      if (decoded) {
        if (typeof decoded.error === 'string' && decoded.error.length > 0) {
          headerError = decoded.error;
        }
        const list = Array.isArray(decoded.accepts) ? decoded.accepts : [];
        chosen = list.find((p) => networkMatches(p.network, networks)) ?? list[0] ?? null;
      }
    } catch {
      /* malformed header — ignore */
    }
  }

  // The seller's JSON body usually carries the most precise failure text
  // when settlement (not parsing) failed. We try it as a best-effort enrichment.
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
        bodyError = parsed.error;
      }
    }
  } catch {
    /* not JSON — fine */
  }

  if (!chosen && !headerError && !bodyError) return null;

  const price: ReceiptV1['price'] = chosen
    ? {
        amount: chosen.amount,
        currency: 'USDC',
        network: networkFromCaip2(chosen.network) ?? chosen.network,
        asset: chosen.asset,
      }
    : null;

  return {
    price,
    requirementsHash: paymentRequirementsHash(chosen),
    error: bodyError ?? headerError,
  };
}

/**
 * Extract a {@link Settlement} from `response.url` query params. Leash's
 * own seller-kit doesn't emit these anymore (the legacy `redirect_url`
 * hook was removed in favour of `wrap_receipt` + `webhook_url` +
 * X-Leash-* headers), but we keep this fallback in case a buyer-side
 * proxy attaches `?leash_tx=…&leash_receipt=…&leash_agent=…` after the
 * fact. Returns `null` for the common case (no params present).
 */
function parseRedirectSettlement(response: Response): Settlement | null {
  const rawUrl = response.url;
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const txSig = parsed.searchParams.get('leash_tx');
  const receiptHash = parsed.searchParams.get('leash_receipt');
  if (!txSig && !receiptHash) return null;
  return {
    txSig: txSig && txSig.length > 0 ? txSig : null,
    price: null,
    requirementsHash: null,
  };
}

function networkMatches(headerNetwork: string, configured: LeashX402Network[]): boolean {
  // The seller sends CAIP-2 form (`solana:<genesis-prefix>`); our config uses
  // friendly slugs like `solana-devnet`. Match leniently on the cluster word.
  const lower = headerNetwork.toLowerCase();
  return configured.some((c) => {
    const slug = String(c).toLowerCase();
    if (slug === lower) return true;
    if (slug.includes('devnet') && lower.includes('etwtrabz')) return true; // devnet genesis prefix
    if (slug.includes('mainnet') && lower.includes('5eykt4u')) return true; // mainnet-beta genesis prefix
    return false;
  });
}

function decodeBase64Json(input: string): unknown {
  // x402 uses base64url; tolerate both standard and URL variants.
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw =
    typeof globalThis.atob === 'function'
      ? globalThis.atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(raw);
}

async function emitReceipt(onReceipt: BuyerConfig['onReceipt'], receipt: ReceiptV1): Promise<void> {
  if (!onReceipt) return;
  try {
    await onReceipt(receipt);
  } catch {
    // Intentionally swallowed: a runner outage must not surface as a buyer-side error.
  }
}

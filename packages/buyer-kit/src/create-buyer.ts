import type { ReceiptV1, RulesV1 } from '@leash/schemas';
import {
  createSvmBuyerFetch,
  decodePaymentResponseHeader,
  evaluate,
  finalizeReceipt,
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
   * On Node, build it via `createKeyPairSignerFromBytes(secret)`. In the
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

const DEFAULT_FACILITATOR = 'https://facilitator.svmacc.tech';

/**
 * Build a Leash buyer agent. The returned `fetch` enforces the policy
 * (`RulesV1`) before paying, then delegates to a real x402-on-Solana fetch
 * (`@x402/fetch` + `ExactSvmScheme`). On every call (paid or denied) it
 * emits a tamper-evident `ReceiptV1` via `onReceipt` so receipts land in
 * the explorer.
 */
export function createBuyer(cfg: BuyerConfig): Buyer {
  const networks = cfg.networks ?? (['solana-devnet'] as LeashX402Network[]);
  const facilitator = cfg.facilitator ?? DEFAULT_FACILITATOR;
  const paidFetch =
    cfg.fetch ??
    createSvmBuyerFetch({
      signer: cfg.signer,
      networks,
      rpcUrl: cfg.rpcUrl,
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

      const response = await paidFetch(url, init);
      state.recentRequestHashes.push(h);

      const settlement = parseSettlement(response);
      // If the seller returned 402, decode its `payment-required` header so we
      // can record what was actually demanded and *why* it didn't settle.
      // We need to .clone() because callers will still want to read the body.
      const quote =
        response.status === 402 && !settlement
          ? await parsePaymentRequired(response.clone(), networks)
          : null;

      const draft = {
        v: '0.1' as const,
        kind: 'spend' as const,
        agent: cfg.agent,
        nonce: state.recentRequestHashes.length - 1,
        ts: new Date().toISOString(),
        policy_v: cfg.rules.v,
        request: { method, url, body_hash: body ? requestHash({ method, url, body }) : null },
        decision: 'allow' as const,
        // Surface the seller / facilitator error verbatim so receipts carry
        // a usable failure reason ("insufficient_funds", "facilitator_error",
        // etc.) instead of a silent null.
        reason: settlement ? null : (quote?.error ?? null),
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
        failureReason: settlement ? undefined : (quote?.error ?? undefined),
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
        network: requirements.network,
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
        network: chosen.network,
        asset: chosen.asset,
      }
    : null;

  return {
    price,
    requirementsHash: paymentRequirementsHash(chosen),
    error: bodyError ?? headerError,
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

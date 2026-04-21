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
      const draft = {
        v: '0.1' as const,
        kind: 'spend' as const,
        agent: cfg.agent,
        nonce: state.recentRequestHashes.length - 1,
        ts: new Date().toISOString(),
        policy_v: cfg.rules.v,
        request: { method, url, body_hash: body ? requestHash({ method, url, body }) : null },
        decision: 'allow' as const,
        reason: null,
        price: settlement?.price ?? {
          amount: cfg.rules.budget.perCall,
          currency: cfg.rules.budget.currency,
        },
        facilitator,
        tx_sig: settlement?.txSig ?? null,
        payment_requirements_hash: settlement?.requirementsHash ?? null,
        response: { status: response.status, body_hash: null },
        prev_receipt_hash: null,
      };
      const receipt = finalizeReceipt(draft);
      await emitReceipt(cfg.onReceipt, receipt);
      return { response, receipt };
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

async function emitReceipt(onReceipt: BuyerConfig['onReceipt'], receipt: ReceiptV1): Promise<void> {
  if (!onReceipt) return;
  try {
    await onReceipt(receipt);
  } catch {
    // Intentionally swallowed: a runner outage must not surface as a buyer-side error.
  }
}

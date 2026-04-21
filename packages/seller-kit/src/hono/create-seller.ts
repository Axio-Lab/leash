import type { Hono } from 'hono';
import type { Context as UmiContext } from '@metaplex-foundation/umi';
import type { ReceiptV1 } from '@leash/schemas';
import { finalizeReceipt, requestHash } from '@leash/core';
import { simpleX402Gate } from './simple-x402.js';
import { resolveSellerPayTo, type AgentSellerConfig } from '../seller/agent-seller.js';
import { parsePrice } from '../receipts/price.js';

export type SellerRouteConfig = {
  description: string;
  /**
   * Display price e.g. `"$0.001"`, `"0.01 USDC"`, or `"0.5"`. Parsed via
   * `parsePrice` and copied into every `earn` receipt as
   * `{ amount, currency }`. v0.1 normalises `$`/`USD` to `USDC`.
   */
  price: string;
};

export type CreateSellerOptions = {
  umi: Pick<UmiContext, 'eddsa' | 'programs'>;
  sellerAgent: AgentSellerConfig;
  routes: Record<string, SellerRouteConfig>;
  /**
   * Called with every settled `earn` receipt (only emitted on successful
   * gated requests, status 2xx/3xx). Use this to ship receipts to the
   * Leash runner — e.g.
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
};

type SellerState = {
  nonce: number;
  prevReceiptHash: string | null;
};

/**
 * Registers an x402-shaped payment gate on the configured route keys
 * (`METHOD /path`) and emits a tamper-evident `earn` `ReceiptV1` after
 * each settled call. Receipts are nonce-ordered and hash-chained per
 * seller agent (matches `@leash/buyer-kit` so explorers can verify both
 * sides of the trade).
 */
export function createSeller(app: Hono, opts: CreateSellerOptions): Seller {
  const payTo = resolveSellerPayTo(opts.umi, opts.sellerAgent);
  const agent = String(opts.sellerAgent.asset);
  const policyVersion = opts.policyVersion ?? '0.1';
  const state: SellerState = { nonce: 0, prevReceiptHash: null };

  for (const route of Object.keys(opts.routes)) {
    const [method, path] = route.split(/\s+/, 2);
    if (!method || !path) {
      throw new Error(`Invalid route key: ${route}`);
    }
    const cfg = opts.routes[route];
    const upper = method.toUpperCase();

    const gate = simpleX402Gate();
    app.use(path, async (c, next) => {
      if (c.req.method !== upper) {
        return next();
      }
      // Wrap the downstream chain with an emitter. The x402 gate calls this
      // ONLY when payment headers are present, so 402 responses never
      // produce a (false) earn receipt.
      const emitAfterHandler = async () => {
        let bodyText: string | null = null;
        try {
          const t = await c.req.raw.clone().text();
          bodyText = t === '' ? null : t;
        } catch {
          // Some runtimes (e.g. GET with no body) throw on .text() — fine.
          bodyText = null;
        }
        await next();
        const status = c.res?.status ?? 0;
        // Only record settled trades. ≥400 means the seller's handler failed
        // after payment was attached, which is its own (uglier) story.
        if (status < 200 || status >= 400) return;
        await emitEarnReceipt({
          state,
          agent,
          policyVersion,
          method: upper,
          url: c.req.url,
          bodyText,
          responseStatus: status,
          txSig: c.req.header('x-tx-sig') ?? null,
          price: parsePrice(cfg.price),
          onReceipt: opts.onReceipt,
        });
      };
      return gate(c, emitAfterHandler);
    });
  }
  return { payTo };
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
  price: ReturnType<typeof parsePrice>;
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
    facilitator: 'local' as const,
    tx_sig: args.txSig,
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

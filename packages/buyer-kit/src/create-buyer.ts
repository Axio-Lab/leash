import type { RulesV1 } from '@leash/schemas';
import { evaluate, finalizeReceipt, x402Fetch, requestHash, type PolicyState } from '@leash/core';

export type BuyerConfig = {
  agent: string;
  rules: RulesV1;
  /** Initial spent today (decimal string). */
  spentToday?: string;
};

export type Buyer = {
  fetch(
    url: string,
    init?: RequestInit,
  ): Promise<{ response: Response; receipt: ReturnType<typeof finalizeReceipt> }>;
};

export function createBuyer(cfg: BuyerConfig): Buyer {
  const state: PolicyState = {
    rules: cfg.rules,
    spentToday: cfg.spentToday ?? '0',
    recentRequestHashes: [],
  };

  return {
    async fetch(url, init) {
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
        return {
          response: new Response(JSON.stringify({ error: pol.reason }), { status: 403 }),
          receipt,
        };
      }
      const result = await x402Fetch(url, init, {
        onPaymentRequired: async () => ({ 'x-payment': 'mock' }),
      });
      state.recentRequestHashes.push(h);
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
        price: { amount: cfg.rules.budget.perCall, currency: cfg.rules.budget.currency },
        facilitator: 'local' as const,
        tx_sig: result.txSig,
        response: { status: result.status, body_hash: null },
        prev_receipt_hash: null,
      };
      const receipt = finalizeReceipt(draft);
      return { response: result.response, receipt };
    },
  };
}

import type { RulesV1 } from '@leashmarket/schemas';
import type { PolicyState } from './state.js';

export type PolicyRequest = {
  method: string;
  url: string;
  estimatedPrice?: string;
  requestHash: string;
};

export type PolicyDecision = { decision: 'allow' } | { decision: 'deny'; reason: string };

function cmpDecimal(a: string, b: string): number {
  return Number.parseFloat(a) - Number.parseFloat(b);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Pure policy gate — no IO. */
export function evaluate(req: PolicyRequest, rules: RulesV1, state: PolicyState): PolicyDecision {
  if (state.recentRequestHashes.includes(req.requestHash)) {
    return { decision: 'deny', reason: 'replay' };
  }
  const host = hostFromUrl(req.url);
  if (rules.hosts.deny?.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { decision: 'deny', reason: 'denyHost' };
  }
  if (rules.hosts.allow && rules.hosts.allow.length > 0) {
    const ok = rules.hosts.allow.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok) {
      return { decision: 'deny', reason: 'allowHost' };
    }
  }
  if (req.estimatedPrice && rules.priceCeiling) {
    if (cmpDecimal(req.estimatedPrice, rules.priceCeiling) > 0) {
      return { decision: 'deny', reason: 'priceCeiling' };
    }
  }
  const nextSpend =
    req.estimatedPrice !== undefined
      ? String(Number.parseFloat(state.spentToday) + Number.parseFloat(req.estimatedPrice))
      : state.spentToday;
  if (cmpDecimal(state.spentToday, rules.budget.daily) > 0) {
    return { decision: 'deny', reason: 'dailyBudgetExceeded' };
  }
  if (cmpDecimal(nextSpend, rules.budget.daily) > 0) {
    return { decision: 'deny', reason: 'dailyBudgetExceeded' };
  }
  if (req.estimatedPrice && cmpDecimal(req.estimatedPrice, rules.budget.perCall) > 0) {
    return { decision: 'deny', reason: 'perCallMax' };
  }
  return { decision: 'allow' };
}

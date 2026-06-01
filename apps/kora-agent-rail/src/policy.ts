import type { CallerTrust, KoraAgent, KoraToolName, PolicyDecision } from './types.js';

export type PolicyInput = {
  agent: KoraAgent;
  tool: KoraToolName;
  caller: CallerTrust;
  amount?: number;
  currency?: string;
  currentDailyTotal?: number;
  publicTool?: boolean;
};

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const checks: PolicyDecision['checks'] = [];
  const policy = input.agent.policy;
  const amount = input.amount ?? null;
  const currency = input.currency?.toUpperCase() ?? null;

  checks.push({
    name: 'capability_enabled',
    passed: policy.allowedCapabilities.includes(input.tool),
    detail: policy.allowedCapabilities.includes(input.tool)
      ? `${input.tool} is enabled`
      : `${input.tool} is not enabled for this Kora Agent`,
  });

  if (!input.publicTool && policy.requireVerifiedAgent) {
    checks.push({
      name: 'caller_verified',
      passed: input.caller.verified,
      detail: input.caller.verified
        ? input.caller.detail
        : 'protected Kora tools require a verified Leash caller identity',
    });
  }

  const allowList = policy.allowedCallers;
  const hasAllowList =
    allowList.mints.length > 0 || allowList.handles.length > 0 || allowList.domains.length > 0;
  if (hasAllowList) {
    const selector = input.caller.selector;
    const allowed =
      (selector?.mint != null && allowList.mints.includes(selector.mint)) ||
      (input.caller.resolvedMint != null && allowList.mints.includes(input.caller.resolvedMint)) ||
      (selector?.handle != null && allowList.handles.includes(selector.handle)) ||
      (selector?.domain != null && allowList.domains.includes(selector.domain));
    checks.push({
      name: 'caller_allow_list',
      passed: allowed,
      detail: allowed ? 'caller is explicitly allowed' : 'caller is not in the allow list',
    });
  }

  if (currency != null) {
    checks.push({
      name: 'currency_allowed',
      passed: policy.allowedCurrencies.includes(currency),
      detail: policy.allowedCurrencies.includes(currency)
        ? `${currency} is enabled`
        : `${currency} is not enabled for this Kora Agent`,
    });
  }

  if (amount != null) {
    checks.push({
      name: 'amount_positive',
      passed: Number.isFinite(amount) && amount > 0,
      detail: Number.isFinite(amount) && amount > 0 ? 'amount is positive' : 'amount is invalid',
    });
    checks.push({
      name: 'per_payout_limit',
      passed: amount <= policy.maxPayoutAmount,
      detail: `${amount} vs max ${policy.maxPayoutAmount}`,
    });
    const projected = (input.currentDailyTotal ?? 0) + amount;
    checks.push({
      name: 'daily_limit',
      passed: projected <= policy.dailyPayoutLimit,
      detail: `${projected} projected vs daily limit ${policy.dailyPayoutLimit}`,
    });
  }

  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    return {
      status: 'denied',
      reason: failed.map((check) => check.detail).join('; '),
      checks,
    };
  }

  if (amount != null && amount > policy.approvalThreshold) {
    return {
      status: 'approval_required',
      reason: `${amount} exceeds approval threshold ${policy.approvalThreshold}`,
      checks: [
        ...checks,
        {
          name: 'approval_threshold',
          passed: false,
          detail: `${amount} requires human approval`,
        },
      ],
    };
  }

  return { status: 'allowed', reason: 'policy allowed this Kora action', checks };
}

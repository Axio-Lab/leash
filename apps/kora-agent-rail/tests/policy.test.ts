import { describe, expect, it } from 'vitest';

import { buildCapabilities } from '../src/capabilities.js';
import { evaluatePolicy } from '../src/policy.js';
import type { CallerTrust, KoraAgent } from '../src/types.js';

const verifiedCaller: CallerTrust = {
  status: 'verified',
  verified: true,
  selector: { mint: 'agent-mint' },
  resolvedMint: 'agent-mint',
  detail: 'verified',
};

const missingCaller: CallerTrust = {
  status: 'missing',
  verified: false,
  selector: null,
  resolvedMint: null,
  detail: 'missing',
};

function agent(): KoraAgent {
  const now = new Date().toISOString();
  return {
    id: 'demo',
    name: 'Demo',
    description: '',
    createdAt: now,
    updatedAt: now,
    capabilities: buildCapabilities('http://localhost:4300'),
    policy: {
      allowedCapabilities: [
        'kora_get_agent_capabilities',
        'kora_get_balance',
        'kora_list_banks',
        'kora_resolve_bank_account',
        'kora_create_payout',
        'kora_get_payout_status',
        'kora_list_payouts',
        'kora_create_checkout',
        'kora_create_virtual_account',
      ],
      allowedCurrencies: ['NGN'],
      requireVerifiedAgent: true,
      allowedCallers: { mints: [], handles: [], domains: [] },
      maxPayoutAmount: 100_000,
      dailyPayoutLimit: 500_000,
      approvalThreshold: 50_000,
    },
  };
}

describe('Kora Agent policy', () => {
  it('allows a verified in-limit local-currency payout', () => {
    const decision = evaluatePolicy({
      agent: agent(),
      tool: 'kora_create_payout',
      caller: verifiedCaller,
      amount: 25_000,
      currency: 'NGN',
      currentDailyTotal: 0,
    });

    expect(decision.status).toBe('allowed');
  });

  it('requires approval above the configured threshold', () => {
    const decision = evaluatePolicy({
      agent: agent(),
      tool: 'kora_create_payout',
      caller: verifiedCaller,
      amount: 75_000,
      currency: 'NGN',
      currentDailyTotal: 0,
    });

    expect(decision.status).toBe('approval_required');
  });

  it('denies protected calls without a verified caller', () => {
    const decision = evaluatePolicy({
      agent: agent(),
      tool: 'kora_create_payout',
      caller: missingCaller,
      amount: 25_000,
      currency: 'NGN',
      currentDailyTotal: 0,
    });

    expect(decision.status).toBe('denied');
    expect(decision.reason).toMatch(/verified Leash caller/);
  });

  it('denies unsupported currencies before reaching Kora', () => {
    const decision = evaluatePolicy({
      agent: agent(),
      tool: 'kora_create_payout',
      caller: verifiedCaller,
      amount: 25_000,
      currency: 'USD',
      currentDailyTotal: 0,
    });

    expect(decision.status).toBe('denied');
    expect(decision.reason).toMatch(/USD is not enabled/);
  });
});

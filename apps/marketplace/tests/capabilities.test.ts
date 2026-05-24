import { describe, expect, it } from 'vitest';

import {
  capabilityCount,
  capabilityCountHint,
  capabilityCountLabel,
  paySkillsProviderPath,
} from '../lib/capabilities';

describe('capability labels', () => {
  it('counts pay.sh endpoints as capabilities', () => {
    const item = { source: 'pay-skills' as const, tools: [], endpoint_count: 1 };
    expect(capabilityCount(item)).toBe(1);
    expect(capabilityCountLabel(item)).toBe('1 capability');
    expect(capabilityCountHint(item)).toBe('1 payable endpoint');
  });

  it('counts native listing endpoints', () => {
    const item = { source: 'leash' as const, endpoints: [{ method: 'POST' }] };
    expect(capabilityCount(item)).toBe(1);
    expect(capabilityCountLabel(item)).toBe('1 capability');
    expect(capabilityCountHint(item)).toBe('1 payable endpoint');
  });

  it('builds a safe provider detail path for pay.sh FQNs', () => {
    expect(paySkillsProviderPath('agentmail/email')).toBe('/api/pay-skills/agentmail/email');
    expect(
      paySkillsProviderPath('coinbase-cdp/coinbase-developer-platform/baseSepoliaWalletApi'),
    ).toBe('/api/pay-skills/coinbase-cdp/coinbase-developer-platform/baseSepoliaWalletApi');
  });
});

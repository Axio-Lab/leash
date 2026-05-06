import { describe, expect, it } from 'vitest';
import type { RulesV1 } from '@leashmarket/schemas';
import { evaluate } from '../src/policy/evaluate.js';
import type { PolicyState } from '../src/policy/state.js';

const rules: RulesV1 = {
  v: '0.1',
  budget: { daily: '1', perCall: '0.5', currency: 'USDC' },
  hosts: { allow: ['good.example'], deny: ['bad.example'] },
  triggers: [],
};

const baseState: PolicyState = {
  rules,
  spentToday: '0',
  recentRequestHashes: [],
};

describe('evaluate', () => {
  it('allows good host', () => {
    const r = evaluate(
      {
        method: 'GET',
        url: 'https://good.example/x',
        requestHash: 'h1',
        estimatedPrice: '0.1',
      },
      rules,
      baseState,
    );
    expect(r).toEqual({ decision: 'allow' });
  });
  it('denies bad host', () => {
    const r = evaluate(
      { method: 'GET', url: 'https://bad.example/x', requestHash: 'h2' },
      rules,
      baseState,
    );
    expect(r).toEqual({ decision: 'deny', reason: 'denyHost' });
  });
  it('denies replay', () => {
    const st: PolicyState = { ...baseState, recentRequestHashes: ['h3'] };
    const r = evaluate(
      { method: 'GET', url: 'https://good.example/x', requestHash: 'h3' },
      rules,
      st,
    );
    expect(r).toEqual({ decision: 'deny', reason: 'replay' });
  });
  it('denies per-call max', () => {
    const r = evaluate(
      {
        method: 'GET',
        url: 'https://good.example/x',
        requestHash: 'h4',
        estimatedPrice: '1',
      },
      rules,
      baseState,
    );
    expect(r).toEqual({ decision: 'deny', reason: 'perCallMax' });
  });
});

import { describe, expect, it } from 'vitest';

import { applySetField, DEFAULT_DRAFT, isDraftComplete } from '../lib/agent-helper';

describe('applySetField', () => {
  it('updates name and description', () => {
    let d = applySetField(DEFAULT_DRAFT, 'name', 'Researcher');
    d = applySetField(d, 'description', 'Solana research');
    expect(d.name).toBe('Researcher');
    expect(d.description).toBe('Solana research');
  });

  it('switching model also updates llmProvider', () => {
    let d = applySetField(DEFAULT_DRAFT, 'model', 'gpt-4o');
    expect(d.model).toBe('gpt-4o');
    expect(d.llmProvider).toBe('openai');
    d = applySetField(d, 'model', 'claude-3-5-sonnet');
    expect(d.llmProvider).toBe('anthropic');
  });

  it('ignores unknown model', () => {
    const d = applySetField(DEFAULT_DRAFT, 'model', 'unknown');
    expect(d.model).toBe(DEFAULT_DRAFT.model);
  });

  it('updates budget fields independently', () => {
    let d = applySetField(DEFAULT_DRAFT, 'budget.per_action', '0.05');
    d = applySetField(d, 'budget.per_task', '2.00');
    expect(d.budget.perAction).toBe('0.05');
    expect(d.budget.perTask).toBe('2.00');
    expect(d.budget.perDay).toBe(DEFAULT_DRAFT.budget.perDay);
  });

  it('isDraftComplete checks every required field', () => {
    expect(isDraftComplete(DEFAULT_DRAFT)).toBe(false);
    let d = applySetField(DEFAULT_DRAFT, 'name', 'a');
    d = applySetField(d, 'description', 'd');
    d = applySetField(d, 'system_prompt', 's');
    expect(isDraftComplete(d)).toBe(false);
    const withTool = {
      ...d,
      capabilities: [{ slug: null, endpoint: 'https://x.example/mcp', tools: ['t'] }],
    };
    expect(isDraftComplete(withTool)).toBe(true);
  });
});

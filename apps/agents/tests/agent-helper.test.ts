import { describe, expect, it } from 'vitest';

import { applySetField, DEFAULT_DRAFT, isDraftComplete } from '../lib/agent-helper';

describe('applySetField', () => {
  it('updates name and description', () => {
    let d = applySetField(DEFAULT_DRAFT, 'name', 'Researcher');
    d = applySetField(d, 'description', 'Solana research');
    expect(d.name).toBe('Researcher');
    expect(d.description).toBe('Solana research');
  });

  it('isDraftComplete requires name and description', () => {
    expect(isDraftComplete(DEFAULT_DRAFT)).toBe(false);
    let d = applySetField(DEFAULT_DRAFT, 'name', 'a');
    expect(isDraftComplete(d)).toBe(false);
    d = applySetField(d, 'description', 'd');
    expect(isDraftComplete(d)).toBe(true);
  });
});

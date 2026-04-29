import { describe, expect, it } from 'vitest';

import { agentUrl, eventUrl, explorerBase, receiptUrl, shortHash, txUrl } from '../lib/explorer';

describe('explorer URLs', () => {
  it('uses default base', () => {
    expect(explorerBase()).toMatch(/^https?:\/\//);
    expect(explorerBase()).not.toMatch(/\/$/);
  });

  it('builds receipt, agent, tx, event paths', () => {
    expect(receiptUrl('abc123')).toContain('/receipt/');
    expect(receiptUrl('abc123')).toContain('abc123');
    expect(agentUrl('MintAddr')).toContain('/agent/MintAddr');
    expect(txUrl('sigxyz')).toContain('/tx/sigxyz');
    expect(eventUrl('evt1')).toContain('/event/evt1');
  });

  it('shortHash truncates long hashes', () => {
    expect(shortHash('abcdefghijklmnop')).toBe('abcdef…mnop');
  });
});

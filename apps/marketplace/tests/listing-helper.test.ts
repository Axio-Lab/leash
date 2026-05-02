import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, isDraftComplete, manifestToDraft, slugify } from '@/lib/listing-helper';

describe('slugify', () => {
  it('lowercases and dasherizes', () => {
    expect(slugify('Premium Web Search')).toBe('premium-web-search');
  });
  it('strips invalid chars', () => {
    expect(slugify('Hello, world!! ✦')).toBe('hello-world');
  });
  it('caps length at 80', () => {
    expect(slugify('a'.repeat(120)).length).toBe(80);
  });
});

describe('manifestToDraft', () => {
  it('falls back to slugified name when slug missing', () => {
    const draft = manifestToDraft({
      name: 'Premium Search',
      slug: null,
      description: 'd',
      category: 'search',
      endpoint: 'https://x/mcp',
      tools: [{ name: 'search', description: 'd' }],
      pricing: { type: 'free' },
    });
    expect(draft.slug).toBe('premium-search');
    expect(draft.tools).toHaveLength(1);
  });

  it('respects explicit slug', () => {
    const draft = manifestToDraft({
      name: 'X',
      slug: 'my-slug',
      description: 'd',
      category: 'misc',
      endpoint: 'https://x',
      tools: [{ name: 't', description: 'd' }],
      pricing: { type: 'per_call', amount: '0.001', currency: 'USDC' },
      docs_url: 'https://docs',
      free_tier: 100,
    });
    expect(draft.slug).toBe('my-slug');
    expect(draft.docsUrl).toBe('https://docs');
    expect(draft.freeTier).toBe(100);
  });
});

describe('isDraftComplete', () => {
  it('rejects empty draft', () => {
    expect(isDraftComplete(EMPTY_DRAFT)).toBe(false);
  });

  it('accepts a fully populated draft', () => {
    const ok = manifestToDraft({
      name: 'X',
      slug: 'my-tool',
      description: 'd',
      category: 'misc',
      endpoint: 'https://x',
      tools: [{ name: 't', description: 'd' }],
      pricing: { type: 'free' },
    });
    expect(isDraftComplete(ok)).toBe(true);
  });

  it('rejects bad slugs', () => {
    const ok = manifestToDraft({
      name: 'X',
      slug: 'BadSlug',
      description: 'd',
      category: 'misc',
      endpoint: 'https://x',
      tools: [{ name: 't', description: 'd' }],
      pricing: { type: 'free' },
    });
    // manifestToDraft preserves explicit slug verbatim (capped to 80)
    expect(isDraftComplete({ ...ok, slug: 'BadSlug' })).toBe(false);
  });
});

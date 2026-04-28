import { describe, expect, it } from 'vitest';

import { validateManifest } from '../lib/mcp-manifest';

describe('validateManifest', () => {
  const valid = {
    name: 'USDC Airtime',
    slug: 'usdc-airtime',
    description: 'Top up phones with USDC',
    endpoint: 'https://airtime.example/mcp',
    tools: [{ name: 'buy_airtime', description: 'Buy airtime', inputSchema: { type: 'object' } }],
    pricing: { type: 'per_call', amount: 'variable', currency: 'USDC' },
    free_tier: 0,
  };

  it('accepts a complete manifest', () => {
    const m = validateManifest(valid);
    expect(m.name).toBe('USDC Airtime');
    expect(m.slug).toBe('usdc-airtime');
    expect(m.tools).toHaveLength(1);
    expect(m.tools[0]!.name).toBe('buy_airtime');
  });

  it('treats missing slug as null', () => {
    const m = validateManifest({ ...valid, slug: undefined });
    expect(m.slug).toBeNull();
  });

  it('rejects non-object input', () => {
    expect(() => validateManifest(null)).toThrow();
    expect(() => validateManifest('string')).toThrow();
  });

  it('rejects when required fields are missing', () => {
    expect(() => validateManifest({ ...valid, name: undefined })).toThrow(/name/);
    expect(() => validateManifest({ ...valid, endpoint: undefined })).toThrow(/endpoint/);
    expect(() => validateManifest({ ...valid, tools: 'nope' })).toThrow(/tools/);
    expect(() => validateManifest({ ...valid, pricing: undefined })).toThrow(/pricing/);
  });

  it('requires endpoint to be http/https', () => {
    expect(() => validateManifest({ ...valid, endpoint: 'ftp://x' })).toThrow();
  });

  it('rejects malformed tools', () => {
    expect(() => validateManifest({ ...valid, tools: [{}] })).toThrow();
  });
});

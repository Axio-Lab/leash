import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveByoUri } from '../src/resolve.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveByoUri', () => {
  it('parses valid registration', async () => {
    const doc = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'A',
      description: 'D',
      image: 'https://i',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(doc), { status: 200 })),
    );
    const r = await resolveByoUri('https://example.com/r.json');
    expect(r.source).toBe('byo');
    expect(r.document.name).toBe('A');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/api.js';

describe('apiFetch', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.LEASH_EXPLORER_API_KEY_DEVNET = 'lsh_test_xyz';
    process.env.LEASH_EXPLORER_API_KEY_MAINNET = 'lsh_live_xyz';
    process.env.LEASH_API_URL = 'https://api.example.test';
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('returns api_key_missing when no key for the network is configured', async () => {
    delete process.env.LEASH_EXPLORER_API_KEY_DEVNET;
    const res = await apiFetch<{ ok: true }>('devnet', '/v1/whatever');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('api_key_missing');
      expect(res.status).toBe(0);
    }
  });

  it('uses the right API key per network and forwards path', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const headers = new Headers((init?.headers as HeadersInit) ?? {});
      const auth = headers.get('authorization');
      return new Response(JSON.stringify({ url: input, auth }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const dev = await apiFetch<{ url: string; auth: string }>('devnet', '/v1/health');
    expect(dev.ok).toBe(true);
    if (dev.ok) {
      expect(dev.data.url).toBe('https://api.example.test/v1/health');
      expect(dev.data.auth).toBe('Bearer lsh_test_xyz');
    }

    const main = await apiFetch<{ url: string; auth: string }>('mainnet', '/v1/health');
    expect(main.ok).toBe(true);
    if (main.ok) {
      expect(main.data.auth).toBe('Bearer lsh_live_xyz');
    }
  });

  it('maps 404 to a structured not_found result', async () => {
    global.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const res = await apiFetch<{ ok: true }>('devnet', '/v1/agents/missing');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('not_found');
      expect(res.status).toBe(404);
    }
  });

  it('captures network failures as api_unreachable', async () => {
    global.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const res = await apiFetch<{ ok: true }>('devnet', '/v1/health');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('api_unreachable');
    }
  });
});

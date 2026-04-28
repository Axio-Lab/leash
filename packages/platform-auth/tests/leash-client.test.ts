import { describe, expect, it } from 'vitest';

import { LeashAdminError, createLeashAdminClient } from '../src/leash-client.js';

function mockFetch(handler: (input: string | URL, init?: RequestInit) => Response) {
  return ((input, init) => Promise.resolve(handler(input as string | URL, init))) as typeof fetch;
}

describe('createLeashAdminClient', () => {
  it('creates an api key with bearer admin secret', async () => {
    let captured: { url: string; auth: string | null; body: string } | null = null;
    const client = createLeashAdminClient({
      baseUrl: 'http://api.test',
      adminSecret: 'super-secret',
      fetchImpl: mockFetch((input, init) => {
        captured = {
          url: typeof input === 'string' ? input : String(input),
          auth: new Headers(init?.headers).get('authorization'),
          body: String(init?.body ?? ''),
        };
        return new Response(
          JSON.stringify({
            key: {
              id: 'key1',
              label: 'l',
              network: 'solana-devnet',
              prefix: 'lsh_test_',
              last4: 'aaaa',
              owner_wallet: '11111111111111111111111111111111',
              scopes: ['agents'],
              created_at: '2026-01-01T00:00:00.000Z',
              disabled_at: null,
            },
            plaintext: 'lsh_test_xxx',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    });

    const result = await client.createApiKey({
      label: 'l',
      network: 'solana-devnet',
      ownerWallet: '11111111111111111111111111111111',
      scopes: ['agents'],
    });
    expect(result.plaintext).toBe('lsh_test_xxx');
    expect(captured!.url).toBe('http://api.test/v1/admin/api-keys');
    expect(captured!.auth).toBe('Bearer super-secret');
    const sent = JSON.parse(captured!.body);
    expect(sent).toEqual({
      label: 'l',
      network: 'solana-devnet',
      owner_wallet: '11111111111111111111111111111111',
      scopes: ['agents'],
    });
  });

  it('translates non-2xx responses to LeashAdminError', async () => {
    const client = createLeashAdminClient({
      baseUrl: 'http://api.test',
      adminSecret: 's',
      fetchImpl: mockFetch(
        () =>
          new Response(JSON.stringify({ error: 'invalid_request', message: 'bad' }), {
            status: 422,
          }),
      ),
    });
    await expect(
      client.createApiKey({
        label: 'l',
        network: 'solana-devnet',
        ownerWallet: '11111111111111111111111111111111',
      }),
    ).rejects.toMatchObject({
      name: 'LeashAdminError',
      status: 422,
      code: 'invalid_request',
    });
  });

  it('lists keys with query filters', async () => {
    let captured = '';
    const client = createLeashAdminClient({
      baseUrl: 'http://api.test/',
      adminSecret: 's',
      fetchImpl: mockFetch((input) => {
        captured = typeof input === 'string' ? input : String(input);
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    });
    await client.listApiKeys({
      network: 'solana-devnet',
      ownerWallet: 'abc',
      includeDisabled: true,
    });
    expect(captured).toContain('/v1/admin/api-keys?');
    expect(captured).toContain('network=solana-devnet');
    expect(captured).toContain('owner_wallet=abc');
    expect(captured).toContain('include_disabled=true');
  });

  it('disables a key', async () => {
    let captured = '';
    const client = createLeashAdminClient({
      baseUrl: 'http://api.test',
      adminSecret: 's',
      fetchImpl: mockFetch((input) => {
        captured = typeof input === 'string' ? input : String(input);
        return new Response(
          JSON.stringify({
            key: {
              id: 'key1',
              label: 'l',
              network: 'solana-devnet',
              prefix: 'lsh_test_',
              last4: 'aaaa',
              owner_wallet: null,
              scopes: null,
              created_at: '2026-01-01T00:00:00.000Z',
              disabled_at: '2026-01-02T00:00:00.000Z',
            },
          }),
          { status: 200 },
        );
      }),
    });
    const after = await client.disableApiKey('key1');
    expect(captured).toBe('http://api.test/v1/admin/api-keys/key1/disable');
    expect(after.disabled_at).toBeTruthy();
  });

  it('LeashAdminError exposes status and code', () => {
    const e = new LeashAdminError(403, 'forbidden', 'nope');
    expect(e.status).toBe(403);
    expect(e.code).toBe('forbidden');
    expect(e.message).toBe('nope');
  });
});

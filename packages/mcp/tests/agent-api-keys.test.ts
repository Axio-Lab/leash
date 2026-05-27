import { generateSigner } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LeashAgentConfig } from '../src/config.js';
import { createStdioHost } from '../src/host-stdio.js';

const savedFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = savedFetch;
});

function freshConfig(): LeashAgentConfig {
  const umi = createUmi('https://invalid');
  const executive = generateSigner(umi);
  const mint = generateSigner(umi);
  const kp = umi.eddsa.createKeypairFromSecretKey(executive.secretKey);
  return {
    agentMint: mint.publicKey.toString(),
    executiveSecretBase58: base58.deserialize(kp.secretKey)[0],
    network: 'solana-devnet',
    apiBaseUrl: 'https://api.example.test',
    rpcUrl: 'https://rpc.example.test',
    explorerBaseUrl: 'https://explorer.example.test',
    apiKey: null,
  };
}

function parseToolResult<T>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(result.content[0]!.text) as T;
}

describe('stdio host agent API keys', () => {
  it('creates an agent API key with X-Leash-Sig and no bearer token', async () => {
    const cfg = freshConfig();
    const host = createStdioHost(cfg);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      const body = JSON.parse(String(init?.body)) as { label: string };
      return new Response(
        JSON.stringify({
          key: {
            id: 'key_1',
            label: body.label,
            network: 'solana-devnet',
            prefix: 'lsh_test_',
            last4: 'abcd',
            owner_wallet: host.ownerWallet,
            agent_mint: cfg.agentMint,
            scopes: ['agent'],
            created_at: '2026-05-27T00:00:00.000Z',
            disabled_at: null,
          },
          plaintext: 'lsh_test_exampleabcd',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await host.createAgentApiKey({ label: 'local MCP' });
    const parsed = parseToolResult<{
      status: string;
      plaintext: string;
      key: { scopes: string[]; agent_mint: string };
      warning: string;
    }>(result);

    expect(parsed.status).toBe('ok');
    expect(parsed.plaintext).toBe('lsh_test_exampleabcd');
    expect(parsed.key.scopes).toEqual(['agent']);
    expect(parsed.key.agent_mint).toBe(cfg.agentMint);
    expect(parsed.warning).toContain('Plaintext is returned only once');

    const headers = new Headers(calls[0]!.init?.headers);
    expect(calls[0]!.url).toBe(`https://api.example.test/v1/agents/${cfg.agentMint}/api-keys`);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-leash-agent')).toBe(cfg.agentMint);
    expect(headers.get('x-leash-timestamp')).toMatch(/Z$/);
    expect(headers.get('x-leash-sig')).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('lists and revokes agent API keys using signed routes', async () => {
    const cfg = freshConfig();
    const host = createStdioHost(cfg);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          key: {
            id: 'key_1',
            label: 'local MCP',
            network: 'solana-devnet',
            prefix: 'lsh_test_',
            last4: 'abcd',
            owner_wallet: host.ownerWallet,
            agent_mint: cfg.agentMint,
            scopes: ['agent'],
            created_at: '2026-05-27T00:00:00.000Z',
            disabled_at: '2026-05-27T00:01:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const list = parseToolResult<{ status: string; count: number }>(
      await host.listAgentApiKeys({ include_disabled: true, limit: 5 }),
    );
    const revoke = parseToolResult<{ status: string; key: { id: string } }>(
      await host.revokeAgentApiKey({ id: 'key_1' }),
    );

    expect(list).toMatchObject({ status: 'ok', count: 0 });
    expect(revoke).toMatchObject({ status: 'revoked', key: { id: 'key_1' } });
    expect(calls[0]!.url).toBe(
      `https://api.example.test/v1/agents/${cfg.agentMint}/api-keys?include_disabled=true&limit=5`,
    );
    expect(calls[1]!.url).toBe(
      `https://api.example.test/v1/agents/${cfg.agentMint}/api-keys/key_1/disable`,
    );
    expect(new Headers(calls[1]!.init?.headers).get('x-leash-agent')).toBe(cfg.agentMint);
  });
});

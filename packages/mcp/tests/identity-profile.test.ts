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

describe('stdio host identity profile', () => {
  it('manages identity profile resources using signed agent routes', async () => {
    const cfg = freshConfig();
    const host = createStdioHost(cfg);
    const profile = {
      mint: cfg.agentMint,
      network: 'solana-devnet',
      handle: 'mcp-demo',
      name: 'MCP Demo',
      description: null,
      image_url: null,
      treasury: generateSigner(createUmi('https://invalid')).publicKey.toString(),
      services: [],
      verified_domains: [],
      capability_cards: [],
      claims: [],
      operator_history: [],
      reputation: { settled_calls: 0, denied_calls: 0, rating: 0 },
    };
    const claim = {
      id: 'claim_1',
      issuer: 'mcp',
      subject_mint: cfg.agentMint,
      type: 'verified_builder',
      value: 'true',
      evidence_url: null,
      signature: 'sig_1234567890123456',
      visibility: 'public',
      expires_at: null,
      revoked_at: null,
      created_at: '2026-05-27T00:00:00.000Z',
    };
    const disclosure = {
      id: 'disc_1',
      agent_mint: cfg.agentMint,
      network: 'solana-devnet',
      resources: [{ kind: 'claim', id: claim.id }],
      expires_at: '2026-06-03T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-05-27T00:00:00.000Z',
      token: 'tok_123',
      url: 'https://api.example.test/v1/identity/disclosures/tok_123',
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      if (url.endsWith('/identity') && init?.method === 'GET') {
        return Response.json(profile);
      }
      if (url.endsWith('/identity') && init?.method === 'PUT') {
        return Response.json({ ...profile, handle: JSON.parse(String(init.body)).handle });
      }
      if (url.endsWith('/domains/verify')) {
        return Response.json({ domain: JSON.parse(String(init?.body)).domain, status: 'verified' });
      }
      if (url.endsWith('/claims') && init?.method === 'POST') {
        return Response.json(claim);
      }
      if (url.includes('/claims/') && init?.method === 'DELETE') {
        return Response.json({ ok: true });
      }
      if (url.endsWith('/disclosures') && init?.method === 'GET') {
        return Response.json({ items: [] });
      }
      if (url.endsWith('/disclosures') && init?.method === 'POST') {
        return Response.json(disclosure);
      }
      if (url.includes('/disclosures/') && init?.method === 'DELETE') {
        return Response.json({ ok: true });
      }
      return Response.json({ message: 'not found' }, { status: 404 });
    }) as typeof fetch;

    expect(
      parseToolResult<{ status: string; profile: { mint: string } }>(
        await host.getIdentityProfile({}),
      ),
    ).toMatchObject({ status: 'ok', profile: { mint: cfg.agentMint } });
    await host.updateIdentityProfile({ handle: 'mcp-demo' });
    expect(
      parseToolResult<{ status: string; domain: string }>(
        await host.verifyIdentityDomain({ domain: 'mcp.example' }),
      ),
    ).toMatchObject({ status: 'verified', domain: 'mcp.example' });
    expect(
      parseToolResult<{ status: string; claim: { id: string } }>(
        await host.createIdentityClaim({
          issuer: 'mcp',
          type: 'verified_builder',
          value: 'true',
          signature: 'sig_1234567890123456',
        }),
      ),
    ).toMatchObject({ status: 'ok', claim: { id: 'claim_1' } });
    expect(
      parseToolResult<{ status: string; id: string }>(
        await host.revokeIdentityClaim({ id: 'claim_1' }),
      ),
    ).toMatchObject({ status: 'revoked', id: 'claim_1' });
    expect(
      parseToolResult<{ status: string; count: number }>(await host.listIdentityDisclosures({})),
    ).toMatchObject({ status: 'ok', count: 0 });
    expect(
      parseToolResult<{ status: string; token: string; url: string }>(
        await host.createIdentityDisclosure({ resources: [{ kind: 'claim', id: 'claim_1' }] }),
      ),
    ).toMatchObject({ status: 'ok', token: 'tok_123' });
    expect(
      parseToolResult<{ status: string; id: string }>(
        await host.revokeIdentityDisclosure({ id: 'disc_1' }),
      ),
    ).toMatchObject({ status: 'revoked', id: 'disc_1' });

    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['GET', `https://api.example.test/v1/agents/${cfg.agentMint}/identity`],
      ['PUT', `https://api.example.test/v1/agents/${cfg.agentMint}/identity`],
      ['POST', `https://api.example.test/v1/agents/${cfg.agentMint}/identity/domains/verify`],
      ['POST', `https://api.example.test/v1/agents/${cfg.agentMint}/identity/claims`],
      ['DELETE', `https://api.example.test/v1/agents/${cfg.agentMint}/identity/claims/claim_1`],
      ['GET', `https://api.example.test/v1/agents/${cfg.agentMint}/identity/disclosures`],
      ['POST', `https://api.example.test/v1/agents/${cfg.agentMint}/identity/disclosures`],
      ['DELETE', `https://api.example.test/v1/agents/${cfg.agentMint}/identity/disclosures/disc_1`],
    ]);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('x-leash-agent')).toBe(cfg.agentMint);
    }
  });
});

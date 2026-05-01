import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { generateSigner } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServerFromEnv } from '../src/server.js';

/**
 * Build a real 64-byte ed25519 secret + matching pubkey. Used as
 * test-input executive material — we never sign anything against
 * chain in this file.
 */
function freshExecutive(): { pubkey: string; secretBase58: string } {
  const umi = createUmi('https://invalid');
  const signer = generateSigner(umi);
  const kp = umi.eddsa.createKeypairFromSecretKey(signer.secretKey);
  return {
    pubkey: kp.publicKey.toString(),
    secretBase58: base58.deserialize(kp.secretKey)[0],
  };
}

const CONFIG_ENV_KEYS = [
  'LEASH_AGENT_MINT',
  'LEASH_EXECUTIVE_KEY',
  'LEASH_NETWORK',
  'LEASH_API_URL',
  'LEASH_RPC_URL',
  'LEASH_API_KEY',
];

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of CONFIG_ENV_KEYS) out[k] = process.env[k];
  return out;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of CONFIG_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

/**
 * Mock the JSON-RPC `getBalance` call Umi runs against the configured
 * RPC URL. Always returns the same lamports value regardless of the
 * pubkey — keeps the test independent of who generated the keypair.
 */
function mockRpcBalance(lamports: bigint): typeof globalThis.fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    const method = (body as { method?: string } | null)?.method;
    if (method === 'getBalance') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: (body as { id?: number } | null)?.id ?? 1,
          result: {
            context: { slot: 1 },
            value: Number(lamports),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch in test: ${method ?? 'unknown'} ${u}`);
  }) as unknown as typeof globalThis.fetch;
}

async function callRegisterAgent(
  client: Client,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: 'leash_register_agent', arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe('leash_register_agent — two-step flow', () => {
  let envSnap: Record<string, string | undefined>;
  let tempDir: string;
  let configPath: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of CONFIG_ENV_KEYS) delete process.env[k];
    tempDir = mkdtempSync(join(tmpdir(), 'leash-mcp-test-'));
    configPath = join(tempDir, 'agent.json');
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
    restoreEnv(envSnap);
  });

  it('first call (generate) → funding_required + pending_register persisted', async () => {
    globalThis.fetch = mockRpcBalance(0n);

    const { server, hostRef, config, pending } = buildServerFromEnv({ configPath });
    expect(config).toBeNull();
    expect(pending).toBeNull();
    expect(hostRef.agentMint).toBeNull();

    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.1' }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const parsed = await callRegisterAgent(client);
    expect(parsed.kind).toBe('register_agent');
    expect(parsed.status).toBe('funding_required');
    expect(parsed.keypair_source).toBe('generated');
    expect(parsed.network).toBe('solana-devnet');
    expect(parsed.balance_lamports).toBe('0');
    expect(parsed.required_lamports).toBe('10000000');
    expect(parsed.config_path).toBe(configPath);
    expect(typeof parsed.executive_pubkey).toBe('string');
    expect((parsed.executive_pubkey as string).length).toBeGreaterThan(30);

    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as {
      agent_mint?: string;
      pending_register?: {
        executive_keypair: string;
        executive_pubkey: string;
        network: string;
      };
    };
    expect(onDisk.agent_mint).toBeUndefined();
    expect(onDisk.pending_register).toBeDefined();
    expect(onDisk.pending_register!.executive_pubkey).toBe(parsed.executive_pubkey);
    expect(onDisk.pending_register!.network).toBe('solana-devnet');
    expect(onDisk.pending_register!.executive_keypair.length).toBeGreaterThan(40);

    expect(hostRef.agentMint).toBeNull();

    await client.close();
    await server.close();
  });

  it('first call (import) → funding_required with the supplied executive', async () => {
    globalThis.fetch = mockRpcBalance(0n);
    const exec = freshExecutive();

    const { server } = buildServerFromEnv({ configPath });
    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.1' }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const parsed = await callRegisterAgent(client, {
      mode: 'import',
      executive_secret_base58: exec.secretBase58,
    });
    expect(parsed.status).toBe('funding_required');
    expect(parsed.keypair_source).toBe('imported');
    expect(parsed.executive_pubkey).toBe(exec.pubkey);

    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as {
      pending_register?: { executive_keypair: string; executive_pubkey: string };
    };
    expect(onDisk.pending_register!.executive_keypair).toBe(exec.secretBase58);
    expect(onDisk.pending_register!.executive_pubkey).toBe(exec.pubkey);

    await client.close();
    await server.close();
  });

  it('mode: "import" without executive_secret_base58 → error', async () => {
    globalThis.fetch = mockRpcBalance(0n);

    const { server } = buildServerFromEnv({ configPath });
    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.1' }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const parsed = await callRegisterAgent(client, { mode: 'import' });
    expect(parsed.status).toBe('error');
    expect(parsed.message).toMatch(/executive_secret_base58/);

    await client.close();
    await server.close();
  });

  it('resume from pending_register → reuses the persisted keypair', async () => {
    const exec = freshExecutive();

    // Pre-populate agent.json with a pending block (simulates a
    // previous register call that returned funding_required).
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        network: 'solana-devnet',
        api_url: 'https://api.leash.market',
        rpc_url: 'https://api.devnet.solana.com',
        explorer_url: 'https://explorer.leash.market',
        pending_register: {
          executive_keypair: exec.secretBase58,
          executive_pubkey: exec.pubkey,
          network: 'solana-devnet',
          created_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      }),
    );

    // Still under-funded — the resume path should re-emit
    // funding_required without rotating the keypair.
    globalThis.fetch = mockRpcBalance(0n);

    const { server, pending } = buildServerFromEnv({ configPath });
    expect(pending).not.toBeNull();
    expect(pending!.executivePubkey).toBe(exec.pubkey);

    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.1' }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const parsed = await callRegisterAgent(client);
    expect(parsed.status).toBe('funding_required');
    expect(parsed.executive_pubkey).toBe(exec.pubkey);
    expect(parsed.keypair_source).toBe('generated');

    await client.close();
    await server.close();
  });

  it('already_registered short-circuits without touching RPC', async () => {
    const exec = freshExecutive();
    const fakeMint = freshExecutive().pubkey;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        agent_mint: fakeMint,
        executive_keypair: exec.secretBase58,
        network: 'solana-devnet',
        api_url: 'https://api.leash.market',
        rpc_url: 'https://api.devnet.solana.com',
        explorer_url: 'https://explorer.leash.market',
        created_at: new Date().toISOString(),
      }),
    );

    globalThis.fetch = vi.fn(async () => {
      throw new Error('fetch should not be called when already registered');
    }) as unknown as typeof globalThis.fetch;

    const { server, config } = buildServerFromEnv({ configPath });
    expect(config!.agentMint).toBe(fakeMint);

    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.1' }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const parsed = await callRegisterAgent(client);
    expect(parsed.status).toBe('already_registered');
    expect(parsed.agent_mint).toBe(fakeMint);

    await client.close();
    await server.close();
  });
});

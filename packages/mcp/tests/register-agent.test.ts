import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { generateSigner } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServerFromEnv } from '../src/server.js';

/**
 * Build a real 64-byte ed25519 secret + matching pubkey so the
 * standalone host can actually decode the keypair after the
 * sandbox response. We never sign anything in this test — the
 * fixture is just for the `loadSigner()` round-trip.
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
 * Synthesises a `POST /v1/sandbox/agent` response shape verbatim,
 * with deterministic dummy data. The host's `registerAgent` should
 * unpack this into a working `LeashAgentConfig`, write it to disk,
 * and swap the inner host so subsequent tool calls (e.g.
 * `leash_get_identity`) report the new mint without an MCP restart.
 */
function makeSandboxResponse(args: {
  executive: { pubkey: string; secretBase58: string };
  mintPubkey: string;
  treasuryPubkey: string;
}) {
  return {
    mint: args.mintPubkey,
    treasury: args.treasuryPubkey,
    executive_pubkey: args.executive.pubkey,
    executive_secret_base58: args.executive.secretBase58,
    network: 'solana-devnet' as const,
    tx_signatures: {
      sol_drip: 'SolDripSig1',
      mint: 'MintSig1',
      usdc_drip: 'UsdcDripSig1',
    },
    explorer_urls: {
      mint: `https://solscan.io/account/${args.mintPubkey}?cluster=devnet`,
      sol_drip: 'https://solscan.io/tx/SolDripSig1?cluster=devnet',
      usdc_drip: 'https://solscan.io/tx/UsdcDripSig1?cluster=devnet',
    },
    funded: { sol_lamports: '10000000', usdc_atomic: '1000000' },
    receipts_service: 'https://api.leash.market/v1/receipts',
  };
}

describe('register_agent hot-swap', () => {
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

  it('writes the config file and upgrades the host so subsequent calls see the new agent', async () => {
    // Mock the sandbox endpoint. Real network call is the only one
    // `registerAgent` makes; we don't touch chain RPCs in this test.
    const exec = freshExecutive();
    // Generate two more valid 32-byte pubkeys for the synthetic
    // mint + treasury addresses.
    const fakeMint = freshExecutive().pubkey;
    const fakeTreasury = freshExecutive().pubkey;
    const sandboxBody = makeSandboxResponse({
      executive: exec,
      mintPubkey: fakeMint,
      treasuryPubkey: fakeTreasury,
    });
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (u.endsWith('/v1/sandbox/agent')) {
        return new Response(JSON.stringify(sandboxBody), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    }) as unknown as typeof globalThis.fetch;

    const { server, hostRef, config } = buildServerFromEnv({ configPath });
    expect(config).toBeNull();
    expect(hostRef.agentMint).toBeNull();

    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'leash-test-client', version: '0.0.1' },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    // 1. Call leash_register_agent — should hit our mock fetch,
    //    write `configPath`, and swap the inner host.
    const registerResult = await client.callTool({
      name: 'leash_register_agent',
      arguments: { name: 'pytest-agent' },
    });
    const registerContent = registerResult.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(registerContent[0]!.text) as {
      kind: string;
      status: string;
      agent_mint: string;
      config_written_to: string;
    };
    expect(parsed.kind).toBe('register_agent');
    if (parsed.status !== 'ok') {
      process.stderr.write(`\nregister_agent payload was: ${registerContent[0]!.text}\n`);
    }
    expect(parsed.status).toBe('ok');
    expect(parsed.agent_mint).toBe(sandboxBody.mint);
    expect(parsed.config_written_to).toBe(configPath);

    // 2. The on-disk file is real JSON in the format `loadAgentConfig`
    //    will read on the next launch.
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as {
      agent_mint: string;
      executive_keypair: string;
      network: string;
    };
    expect(onDisk.agent_mint).toBe(sandboxBody.mint);
    expect(onDisk.executive_keypair).toBe(sandboxBody.executive_secret_base58);
    expect(onDisk.network).toBe('solana-devnet');

    // 3. The in-memory host swapped — `leash_get_identity` now
    //    reports the new mint instead of `no_agent`.
    const identityResult = await client.callTool({
      name: 'leash_get_identity',
      arguments: {},
    });
    const idContent = identityResult.content as Array<{ type: string; text: string }>;
    const id = JSON.parse(idContent[0]!.text) as {
      kind: string;
      status: string;
      agent_mint?: string;
    };
    expect(id.kind).toBe('identity');
    expect(id.status).toBe('ok');
    expect(id.agent_mint).toBe(sandboxBody.mint);

    // 4. Calling register again should yield "already_registered"
    //    via the StdioHost path (not another sandbox request).
    const dupResult = await client.callTool({
      name: 'leash_register_agent',
      arguments: {},
    });
    const dupContent = dupResult.content as Array<{ type: string; text: string }>;
    const dup = JSON.parse(dupContent[0]!.text) as { kind: string; status: string };
    expect(dup.kind).toBe('register_agent');
    expect(dup.status).toBe('already_registered');

    await client.close();
    await server.close();
  });
});

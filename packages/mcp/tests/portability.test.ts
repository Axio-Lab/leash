/**
 * Cross-interface portability — round-trip a `LeashAgentConfig`
 * through the on-disk `agent.json` writer/reader.
 *
 * This is the primitive that powers `leash-mcp export` and
 * `leash-mcp import`: the same JSON shape they read/write is what
 * `loadAgentConfig` consumes on every server boot. If the round-trip
 * here ever breaks, the CLI subcommands break with it.
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateSigner } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LeashAgentConfig } from '../src/config.js';
import { loadAgentConfig } from '../src/config.js';
import { writeAgentConfig } from '../src/config-write.js';

const ENV_KEYS = [
  'LEASH_AGENT_MINT',
  'LEASH_EXECUTIVE_KEY',
  'LEASH_NETWORK',
  'LEASH_API_URL',
  'LEASH_RPC_URL',
  'LEASH_API_KEY',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

function freshConfig(): LeashAgentConfig {
  const umi = createUmi('https://invalid');
  const signer = generateSigner(umi);
  const mint = generateSigner(umi);
  const kp = umi.eddsa.createKeypairFromSecretKey(signer.secretKey);
  return {
    agentMint: mint.publicKey.toString(),
    executiveSecretBase58: base58.deserialize(kp.secretKey)[0],
    network: 'solana-devnet',
    apiBaseUrl: 'https://api.example.test',
    rpcUrl: 'https://rpc.example.test',
    apiKey: null,
  };
}

describe('config round-trip (powers `leash-mcp export` / `import`)', () => {
  let tmp: string;
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmp = mkdtempSync(join(tmpdir(), 'leash-mcp-portability-'));
  });
  afterEach(() => {
    restoreEnv(envSnap);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('write → read round-trips every field', async () => {
    const cfg = freshConfig();
    const path = join(tmp, 'agent.json');
    const written = await writeAgentConfig({ config: cfg, path });
    expect(written).toBe(path);

    // chmod 600 — anyone with mode bits could read the secret.
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const loaded = loadAgentConfig({ path });
    expect(loaded).not.toBeNull();
    expect(loaded!.agentMint).toBe(cfg.agentMint);
    expect(loaded!.executiveSecretBase58).toBe(cfg.executiveSecretBase58);
    expect(loaded!.network).toBe(cfg.network);
    expect(loaded!.apiBaseUrl).toBe(cfg.apiBaseUrl);
    expect(loaded!.rpcUrl).toBe(cfg.rpcUrl);
  });

  it('JSON file shape matches the documented `LeashAgentConfig` v1', async () => {
    const cfg = freshConfig();
    const path = join(tmp, 'agent.json');
    await writeAgentConfig({ config: cfg, path });
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(parsed.agent_mint).toBe(cfg.agentMint);
    expect(parsed.executive_keypair).toBe(cfg.executiveSecretBase58);
    expect(parsed.network).toBe(cfg.network);
    expect(parsed.api_url).toBe(cfg.apiBaseUrl);
    expect(parsed.rpc_url).toBe(cfg.rpcUrl);
    // chmod-600 file should never include `api_key` when the input
    // had a null api_key. Otherwise `null` would leak into git diffs
    // when users commit non-sensitive parts of their config.
    expect(parsed.api_key).toBeUndefined();
  });

  it('env vars override file fields (LEASH_NETWORK, LEASH_RPC_URL)', async () => {
    const cfg = freshConfig();
    const path = join(tmp, 'agent.json');
    await writeAgentConfig({ config: cfg, path });

    process.env.LEASH_NETWORK = 'solana-mainnet';
    process.env.LEASH_RPC_URL = 'https://override.rpc.test';

    const loaded = loadAgentConfig({ path });
    expect(loaded?.network).toBe('solana-mainnet');
    expect(loaded?.rpcUrl).toBe('https://override.rpc.test');
    // Non-overridden fields still come from the file.
    expect(loaded?.apiBaseUrl).toBe(cfg.apiBaseUrl);
  });
});

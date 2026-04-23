/**
 * Pure helpers shared between the CLI demo (`./index.ts`) and its tests.
 * Kept separate so the test file can import them without pulling in
 * `@metaplex-foundation/umi-bundle-defaults` (which would require a real
 * RPC connection at module load time).
 */

import type { LaunchAgentTokenInput, SvmNetwork } from '@leash/registry-utils';

export type DemoEnv = Record<string, string | undefined>;

export function readEnv(env: DemoEnv, name: string, fallback?: string): string {
  const value = env[name];
  if (value && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

export function parseSecret(value: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('LEASH_OWNER_SECRET_KEY must be a JSON array of bytes (e.g. [12, 34, ...])');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('LEASH_OWNER_SECRET_KEY must be a JSON array');
  }
  const bytes = Uint8Array.from(parsed as number[]);
  if (bytes.length !== 64) {
    throw new Error(`LEASH_OWNER_SECRET_KEY must be 64 bytes; got ${bytes.length}`);
  }
  return bytes;
}

export type DemoConfig = {
  network: SvmNetwork;
  rpc: string;
  agentAsset: string;
  tokenName: string;
  tokenSymbol: string;
  tokenImage: string;
  setToken: boolean;
  firstBuyAmount: number;
  secret: Uint8Array;
};

export function readDemoConfig(env: DemoEnv): DemoConfig {
  const network = (readEnv(env, 'LEASH_NETWORK', 'solana-devnet') as SvmNetwork) || 'solana-devnet';
  const rpc = readEnv(
    env,
    'SOLANA_RPC',
    network === 'solana-mainnet'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com',
  );
  const agentAsset = readEnv(env, 'LEASH_AGENT_ASSET');
  const tokenName = readEnv(env, 'LEASH_TOKEN_NAME', 'Demo Agent');
  const tokenSymbol = readEnv(env, 'LEASH_TOKEN_SYMBOL', 'DAGT');
  const tokenImage = readEnv(env, 'LEASH_TOKEN_IMAGE');
  const setToken = readEnv(env, 'LEASH_SET_TOKEN', 'false').toLowerCase() === 'true';
  const firstBuyRaw = readEnv(env, 'LEASH_FIRST_BUY_SOL', '');
  const firstBuyAmount = firstBuyRaw ? Number(firstBuyRaw) : 0;
  const secret = parseSecret(readEnv(env, 'LEASH_OWNER_SECRET_KEY'));
  return {
    network,
    rpc,
    agentAsset,
    tokenName,
    tokenSymbol,
    tokenImage,
    setToken,
    firstBuyAmount,
    secret,
  };
}

export function buildLaunchInput(cfg: DemoConfig): LaunchAgentTokenInput {
  return {
    agentAsset: cfg.agentAsset,
    network: cfg.network,
    setToken: cfg.setToken,
    token: { name: cfg.tokenName, symbol: cfg.tokenSymbol, image: cfg.tokenImage },
    ...(cfg.firstBuyAmount > 0 ? { launch: { firstBuyAmount: cfg.firstBuyAmount } } : {}),
  };
}

export function explorerCluster(network: SvmNetwork): 'mainnet' | 'devnet' {
  return network === 'solana-mainnet' ? 'mainnet' : 'devnet';
}

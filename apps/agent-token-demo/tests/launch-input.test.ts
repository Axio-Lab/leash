import { describe, expect, it } from 'vitest';
import {
  buildLaunchInput,
  explorerCluster,
  parseSecret,
  readDemoConfig,
  readEnv,
} from '../src/launch-input.js';

const SECRET_64 = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));
// 32-character base58 valid Solana address (System Program is a safe constant
// the docs use as a placeholder).
const VALID_ASSET = '11111111111111111111111111111112';
const IRYS_URL = 'https://gateway.irys.xyz/abc123';

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    LEASH_OWNER_SECRET_KEY: SECRET_64,
    LEASH_AGENT_ASSET: VALID_ASSET,
    LEASH_TOKEN_IMAGE: IRYS_URL,
    ...overrides,
  };
}

describe('readEnv', () => {
  it('returns the value when set', () => {
    expect(readEnv({ FOO: 'bar' }, 'FOO')).toBe('bar');
  });
  it('falls back when missing', () => {
    expect(readEnv({}, 'FOO', 'default')).toBe('default');
  });
  it('throws when missing and no fallback', () => {
    expect(() => readEnv({}, 'FOO')).toThrow(/Missing required env var: FOO/);
  });
  it('treats empty strings as missing', () => {
    expect(readEnv({ FOO: '' }, 'FOO', 'default')).toBe('default');
  });
});

describe('parseSecret', () => {
  it('parses a 64-byte JSON array', () => {
    const bytes = parseSecret(SECRET_64);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(64);
    expect(bytes[0]).toBe(0);
    expect(bytes[63]).toBe(63);
  });
  it('rejects non-JSON input', () => {
    expect(() => parseSecret('not json')).toThrow(/JSON array of bytes/);
  });
  it('rejects non-array JSON', () => {
    expect(() => parseSecret('{}')).toThrow(/JSON array/);
  });
  it('rejects wrong-length arrays', () => {
    expect(() => parseSecret('[1,2,3]')).toThrow(/64 bytes/);
  });
});

describe('readDemoConfig', () => {
  it('applies sensible defaults', () => {
    const cfg = readDemoConfig(baseEnv());
    expect(cfg.network).toBe('solana-devnet');
    expect(cfg.rpc).toBe('https://api.devnet.solana.com');
    expect(cfg.tokenName).toBe('Demo Agent');
    expect(cfg.tokenSymbol).toBe('DAGT');
    expect(cfg.setToken).toBe(false);
    expect(cfg.firstBuyAmount).toBe(0);
    expect(cfg.agentAsset).toBe(VALID_ASSET);
    expect(cfg.tokenImage).toBe(IRYS_URL);
  });

  it('switches RPC when LEASH_NETWORK=solana-mainnet', () => {
    const cfg = readDemoConfig(baseEnv({ LEASH_NETWORK: 'solana-mainnet' }));
    expect(cfg.network).toBe('solana-mainnet');
    expect(cfg.rpc).toBe('https://api.mainnet-beta.solana.com');
  });

  it('honors a custom SOLANA_RPC even on devnet', () => {
    const cfg = readDemoConfig(baseEnv({ SOLANA_RPC: 'https://example.test/rpc' }));
    expect(cfg.rpc).toBe('https://example.test/rpc');
  });

  it('parses LEASH_SET_TOKEN as a case-insensitive boolean', () => {
    expect(readDemoConfig(baseEnv({ LEASH_SET_TOKEN: 'TRUE' })).setToken).toBe(true);
    expect(readDemoConfig(baseEnv({ LEASH_SET_TOKEN: 'true' })).setToken).toBe(true);
    expect(readDemoConfig(baseEnv({ LEASH_SET_TOKEN: 'false' })).setToken).toBe(false);
    expect(readDemoConfig(baseEnv({ LEASH_SET_TOKEN: 'yes' })).setToken).toBe(false);
  });

  it('parses LEASH_FIRST_BUY_SOL as a number', () => {
    expect(readDemoConfig(baseEnv({ LEASH_FIRST_BUY_SOL: '0.25' })).firstBuyAmount).toBe(0.25);
    expect(readDemoConfig(baseEnv({ LEASH_FIRST_BUY_SOL: '' })).firstBuyAmount).toBe(0);
  });

  it('throws when required env vars are missing', () => {
    expect(() => readDemoConfig(baseEnv({ LEASH_AGENT_ASSET: undefined }))).toThrow(
      /LEASH_AGENT_ASSET/,
    );
    expect(() => readDemoConfig(baseEnv({ LEASH_TOKEN_IMAGE: undefined }))).toThrow(
      /LEASH_TOKEN_IMAGE/,
    );
    expect(() => readDemoConfig(baseEnv({ LEASH_OWNER_SECRET_KEY: undefined }))).toThrow(
      /LEASH_OWNER_SECRET_KEY/,
    );
  });
});

describe('buildLaunchInput', () => {
  it('omits launch when firstBuyAmount is zero', () => {
    const cfg = readDemoConfig(baseEnv());
    const input = buildLaunchInput(cfg);
    expect(input).toEqual({
      agentAsset: VALID_ASSET,
      network: 'solana-devnet',
      setToken: false,
      token: { name: 'Demo Agent', symbol: 'DAGT', image: IRYS_URL },
    });
    expect(input.launch).toBeUndefined();
  });

  it('forwards firstBuyAmount when positive', () => {
    const cfg = readDemoConfig(baseEnv({ LEASH_FIRST_BUY_SOL: '0.1' }));
    const input = buildLaunchInput(cfg);
    expect(input.launch).toEqual({ firstBuyAmount: 0.1 });
  });

  it('passes setToken through unchanged', () => {
    const cfg = readDemoConfig(baseEnv({ LEASH_SET_TOKEN: 'true' }));
    const input = buildLaunchInput(cfg);
    expect(input.setToken).toBe(true);
  });
});

describe('explorerCluster', () => {
  it('maps mainnet correctly', () => {
    expect(explorerCluster('solana-mainnet')).toBe('mainnet');
  });
  it('defaults non-mainnet to devnet', () => {
    expect(explorerCluster('solana-devnet')).toBe('devnet');
  });
});

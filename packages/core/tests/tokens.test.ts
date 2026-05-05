import { describe, expect, it } from 'vitest';
import {
  KNOWN_TOKENS,
  defaultUsdcMint,
  lookupToken,
  networkFromRpc,
  pinnedMints,
  tokenProgramForMint,
} from '../src/tokens/index.js';

describe('KNOWN_TOKENS', () => {
  it('exposes both networks', () => {
    expect(KNOWN_TOKENS.mainnet.length).toBeGreaterThan(0);
    expect(KNOWN_TOKENS.devnet.length).toBeGreaterThan(0);
  });

  it('looks up USDC on each network', () => {
    expect(lookupToken('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'mainnet')?.symbol).toBe(
      'USDC',
    );
    expect(lookupToken('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'devnet')?.symbol).toBe(
      'USDC',
    );
  });

  it('returns undefined for unknown mints', () => {
    expect(lookupToken('not-a-mint', 'mainnet')).toBeUndefined();
  });

  it('pins stables for both networks', () => {
    expect(pinnedMints('mainnet')).toContain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(pinnedMints('devnet')).toContain('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  });

  it('detects devnet vs mainnet from rpc URL heuristically', () => {
    expect(networkFromRpc('https://api.devnet.solana.com')).toBe('devnet');
    expect(networkFromRpc('http://localhost:8899')).toBe('devnet');
    expect(networkFromRpc('https://api.mainnet-beta.solana.com')).toBe('mainnet');
  });

  it('exposes a default USDC for buyer pre-flight checks', () => {
    expect(defaultUsdcMint('mainnet').symbol).toBe('USDC');
    expect(defaultUsdcMint('devnet').decimals).toBe(6);
  });

  it('tokenProgramForMint distinguishes Token-2022 stables from legacy', () => {
    expect(tokenProgramForMint('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7')).toBe(
      'spl-token-2022',
    );
    expect(tokenProgramForMint('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH')).toBe(
      'spl-token-2022',
    );
    expect(tokenProgramForMint('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')).toBe('spl-token');
    expect(tokenProgramForMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('spl-token');
    expect(tokenProgramForMint('not-a-known-mint')).toBeNull();
  });
});

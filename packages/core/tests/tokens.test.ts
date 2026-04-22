import { describe, expect, it } from 'vitest';
import {
  KNOWN_TOKENS,
  defaultUsdcMint,
  lookupToken,
  networkFromRpc,
  pinnedMints,
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
});

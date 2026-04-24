import { describe, expect, it } from 'vitest';
import { isNetwork, networkFromCookie, networkToSlug, solscanCluster } from '../lib/network.js';

describe('network helpers', () => {
  it('only accepts the two known networks', () => {
    expect(isNetwork('devnet')).toBe(true);
    expect(isNetwork('mainnet')).toBe(true);
    expect(isNetwork('mainnet-beta')).toBe(false);
    expect(isNetwork(undefined)).toBe(false);
    expect(isNetwork(123)).toBe(false);
  });

  it('defaults the cookie to devnet for safety', () => {
    expect(networkFromCookie(undefined)).toBe('devnet');
    expect(networkFromCookie('')).toBe('devnet');
    expect(networkFromCookie('garbage')).toBe('devnet');
    expect(networkFromCookie('mainnet')).toBe('mainnet');
  });

  it('translates to the API network slug', () => {
    expect(networkToSlug('devnet')).toBe('solana-devnet');
    expect(networkToSlug('mainnet')).toBe('solana-mainnet');
  });

  it('builds the right Solscan cluster suffix', () => {
    expect(solscanCluster('mainnet')).toBe('');
    expect(solscanCluster('devnet')).toBe('?cluster=devnet');
  });
});

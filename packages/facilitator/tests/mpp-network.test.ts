import { describe, expect, it } from 'vitest';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } from '@x402/svm';
import { mppNetworkToCaip2 } from '../src/mpp/network.js';

describe('mppNetworkToCaip2', () => {
  it('maps friendly Solana slugs', () => {
    expect(mppNetworkToCaip2('solana-devnet')).toBe(SOLANA_DEVNET_CAIP2);
    expect(mppNetworkToCaip2('SOLANA-MAINNET')).toBe(SOLANA_MAINNET_CAIP2);
  });
  it('passes through CAIP-2 strings', () => {
    expect(mppNetworkToCaip2(SOLANA_DEVNET_CAIP2)).toBe(SOLANA_DEVNET_CAIP2);
  });
  it('returns null for unknown', () => {
    expect(mppNetworkToCaip2('ethereum-mainnet')).toBeNull();
  });
});

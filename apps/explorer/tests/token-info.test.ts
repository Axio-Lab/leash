import { describe, expect, it } from 'vitest';
import { formatTokenAmount, tokenInfoFor } from '../lib/token-info';

const usdcMainnet = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const unknownMint = '11111111111111111111111111111111';

describe('tokenInfoFor', () => {
  it('resolves known stables to their symbol/decimals', () => {
    const info = tokenInfoFor('mainnet', usdcMainnet);
    expect(info.symbol).toBe('USDC');
    expect(info.decimals).toBe(6);
    expect(info.isStable).toBe(true);
  });

  it('falls back to a generic 6-decimal SPL descriptor for unknown mints', () => {
    const info = tokenInfoFor('mainnet', unknownMint);
    expect(info.symbol).toBe('tokens');
    expect(info.decimals).toBe(6);
    expect(info.isStable).toBe(false);
  });
});

describe('formatTokenAmount', () => {
  const usdc = tokenInfoFor('mainnet', usdcMainnet);

  it('renders sub-cent stable amounts without trailing zeros', () => {
    // Regression: previously `0.001 USDC (~$0.0010)` — the trailing
    // zero misled humans into thinking we were quoting cents. The
    // human-readable amount AND the USD estimate must both strip
    // padding past the last significant digit.
    expect(formatTokenAmount('1000', usdc)).toBe('0.001 USDC (~$0.001)');
  });

  it('keeps two decimals for amounts >= 1 cent and < $1', () => {
    expect(formatTokenAmount('500000', usdc)).toBe('0.5 USDC (~$0.50)');
  });

  it('renders dollar amounts with currency formatting', () => {
    expect(formatTokenAmount('1500000', usdc)).toBe('1.5 USDC (~$1.50)');
  });

  it('omits the USD estimate for non-stable tokens', () => {
    const generic = tokenInfoFor('mainnet', unknownMint);
    expect(formatTokenAmount('1000', generic)).toBe('0.001 tokens');
  });

  it('renders missing/empty amounts as the em-dash placeholder', () => {
    expect(formatTokenAmount(null, usdc)).toBe('—');
    expect(formatTokenAmount(undefined, usdc)).toBe('—');
  });
});

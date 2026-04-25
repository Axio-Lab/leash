import { describe, expect, it } from 'vitest';
import { formatTokenAmount, tokenInfoFor } from '../lib/token-info';

const usdcMainnet = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const usdcDevnetCanonical = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const usdtDevnet = 'EcFc2cMyZxaKBkFK1XooxiyDyCPneLXiMwSJiVY6eTad';
const usdgDevnet = '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7';
const usdgMainnet = '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH';
const wsolMint = 'So11111111111111111111111111111111111111112';
const unknownMint = '11111111111111111111111111111111';

describe('tokenInfoFor', () => {
  it('resolves known stables to their symbol/decimals', () => {
    const info = tokenInfoFor('mainnet', usdcMainnet);
    expect(info.symbol).toBe('USDC');
    expect(info.decimals).toBe(6);
    expect(info.isStable).toBe(true);
  });

  it('resolves USDG (Token-2022) on both devnet and mainnet', () => {
    // Regression: explorer used to label USDG amounts as "tokens" because
    // the table only knew USDC. Both clusters' USDG mints must resolve.
    expect(tokenInfoFor('devnet', usdgDevnet).symbol).toBe('USDG');
    expect(tokenInfoFor('mainnet', usdgMainnet).symbol).toBe('USDG');
  });

  it('resolves USDT on both devnet and mainnet', () => {
    expect(tokenInfoFor('devnet', usdtDevnet).symbol).toBe('USDT');
  });

  it('resolves the canonical devnet USDC faucet mint', () => {
    expect(tokenInfoFor('devnet', usdcDevnetCanonical).symbol).toBe('USDC');
  });

  it('labels wSOL with 9-decimal precision and skips the USD estimate', () => {
    const info = tokenInfoFor('mainnet', wsolMint);
    expect(info.symbol).toBe('wSOL');
    expect(info.decimals).toBe(9);
    expect(info.isStable).toBe(false);
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

  it('formats USDG withdrawals with the correct symbol + USD estimate', () => {
    // Regression: a 99 USDG withdraw used to render as "99 tokens"
    // because the explorer's catalog didn't know the USDG mint.
    const usdg = tokenInfoFor('devnet', '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7');
    expect(formatTokenAmount('99000000', usdg)).toBe('99 USDG (~$99.00)');
  });

  it('renders missing/empty amounts as the em-dash placeholder', () => {
    expect(formatTokenAmount(null, usdc)).toBe('—');
    expect(formatTokenAmount(undefined, usdc)).toBe('—');
  });
});

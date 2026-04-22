import { describe, expect, it } from 'vitest';
import {
  atomicToDecimal,
  decimalToAtomic,
  formatReceiptPrice,
  formatReceiptPriceUsd,
  formatReceiptPriceWithCurrency,
  formatTokenBalance,
} from '../src/format/index.js';

describe('atomicToDecimal', () => {
  it('handles whole-number atomics', () => {
    expect(atomicToDecimal('1000000', 6)).toBe('1');
    expect(atomicToDecimal('0', 6)).toBe('0');
  });

  it('handles fractional atomics', () => {
    expect(atomicToDecimal('1234500', 6)).toBe('1.2345');
    expect(atomicToDecimal('2', 6)).toBe('0.000002');
    expect(atomicToDecimal(1500000n, 6)).toBe('1.5');
  });

  it('rejects non-integer strings', () => {
    expect(() => atomicToDecimal('1.5', 6)).toThrow();
  });
});

describe('decimalToAtomic', () => {
  it('round-trips basic decimals', () => {
    expect(decimalToAtomic('1', 6)).toBe(1_000_000n);
    expect(decimalToAtomic('1.5', 6)).toBe(1_500_000n);
    expect(decimalToAtomic('0.000002', 6)).toBe(2n);
  });

  it('rejects too-many-decimals input', () => {
    expect(decimalToAtomic('1.1234567', 6)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(decimalToAtomic('abc', 6)).toBeNull();
    expect(decimalToAtomic('', 6)).toBeNull();
  });
});

describe('formatReceiptPrice family', () => {
  const usdcPrice = {
    amount: '1500000',
    currency: 'USDC',
    network: 'solana-devnet',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  };

  it('formats stablecoin atomic to decimal', () => {
    expect(formatReceiptPrice(usdcPrice, 'devnet')).toBe('1.5');
    expect(formatReceiptPriceWithCurrency(usdcPrice, 'devnet')).toBe('1.5 USDC');
    expect(formatReceiptPriceUsd(usdcPrice, 'devnet')).toBe('$1.50');
  });

  it('USD style pads to two decimals for whole stables', () => {
    expect(formatReceiptPriceUsd({ amount: '2000000', currency: 'USDC' }, 'devnet')).toBe('$2.00');
  });

  it('USD style preserves long tail for sub-cent', () => {
    expect(formatReceiptPriceUsd({ amount: '2', currency: 'USDC' }, 'devnet')).toBe('$0.000002');
  });

  it('non-stablecoins fall back to "<amount> <CCY>"', () => {
    expect(formatReceiptPriceUsd({ amount: '5', currency: 'BONK' }, 'mainnet')).toBe('5 BONK');
  });

  it('passes through legacy decimal strings', () => {
    expect(formatReceiptPrice({ amount: '1.5', currency: 'USDC' })).toBe('1.5');
  });

  it('returns null for nullish input', () => {
    expect(formatReceiptPrice(null)).toBeNull();
    expect(formatReceiptPriceUsd(undefined)).toBeNull();
  });
});

describe('formatTokenBalance', () => {
  it('uses registered decimals to format', () => {
    expect(
      formatTokenBalance('1500000', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'devnet'),
    ).toBe('1.5');
  });

  it('falls back to 0 decimals for unknown mints', () => {
    expect(formatTokenBalance('100', 'unknown-mint', 'devnet')).toBe('100');
  });
});

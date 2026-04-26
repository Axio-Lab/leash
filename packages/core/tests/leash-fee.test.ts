import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyFeeGrossUp,
  buildLeashFeeExtra,
  computeFeeAtoms,
  computeLeashFeeForRequirements,
  LEASH_FEE_AUTHORITY_DEVNET_DEFAULT,
  LEASH_FEE_AUTHORITY_MAINNET_DEFAULT,
  LEASH_FEE_BPS_DEFAULT,
  parseLeashFeeExtra,
  resolveLeashFeeAuthority,
  resolveLeashFeeBps,
  resolveLeashFeeEnforcement,
  type LeashFeeExtra,
} from '../src/fees/leash-fee.js';

describe('computeFeeAtoms', () => {
  it('rounds up so dust never leaks (positive remainder ⇒ +1 atom)', () => {
    expect(computeFeeAtoms(1n, 100)).toBe(1n);
    expect(computeFeeAtoms(999n, 100)).toBe(10n);
    expect(computeFeeAtoms(1_000_000n, 100)).toBe(10_000n);
  });

  it('returns 0 on a 0 amount or 0 bps', () => {
    expect(computeFeeAtoms(0n, 100)).toBe(0n);
    expect(computeFeeAtoms(1_000_000n, 0)).toBe(0n);
  });

  it('handles the maximum bps (10_000 = 100%)', () => {
    expect(computeFeeAtoms(123n, 10_000)).toBe(123n);
  });

  it('rejects negative amounts', () => {
    expect(() => computeFeeAtoms(-1n, 100)).toThrow(/non-negative/);
  });

  it('rejects bps outside [0, 10_000] or non-integer', () => {
    expect(() => computeFeeAtoms(100n, -1)).toThrow(/bps/);
    expect(() => computeFeeAtoms(100n, 10_001)).toThrow(/bps/);
    expect(() => computeFeeAtoms(100n, 1.5)).toThrow(/bps/);
  });
});

describe('applyFeeGrossUp', () => {
  it('returns net + fee with the default 1% rate', () => {
    const r = applyFeeGrossUp(1_000_000n);
    expect(r.net).toBe(1_000_000n);
    expect(r.fee).toBe(10_000n);
    expect(r.gross).toBe(1_010_000n);
  });

  it('honours an explicit bps override', () => {
    const r = applyFeeGrossUp(1_000_000n, 250);
    expect(r.fee).toBe(25_000n);
    expect(r.gross).toBe(1_025_000n);
  });
});

describe('resolveLeashFeeBps', () => {
  const original = process.env.LEASH_FEE_BPS;

  afterEach(() => {
    if (original === undefined) delete process.env.LEASH_FEE_BPS;
    else process.env.LEASH_FEE_BPS = original;
  });

  it('falls back to the default when the env is missing', () => {
    delete process.env.LEASH_FEE_BPS;
    expect(resolveLeashFeeBps()).toBe(LEASH_FEE_BPS_DEFAULT);
  });

  it('honours a sane override', () => {
    process.env.LEASH_FEE_BPS = '50';
    expect(resolveLeashFeeBps()).toBe(50);
  });

  it('clamps insane values back to the default', () => {
    process.env.LEASH_FEE_BPS = '999999';
    expect(resolveLeashFeeBps()).toBe(LEASH_FEE_BPS_DEFAULT);
    process.env.LEASH_FEE_BPS = 'not-a-number';
    expect(resolveLeashFeeBps()).toBe(LEASH_FEE_BPS_DEFAULT);
  });
});

describe('resolveLeashFeeAuthority', () => {
  const originals = {
    main: process.env.LEASH_FEE_AUTHORITY_MAINNET,
    devnet: process.env.LEASH_FEE_AUTHORITY_DEVNET,
  };
  afterEach(() => {
    if (originals.main === undefined) delete process.env.LEASH_FEE_AUTHORITY_MAINNET;
    else process.env.LEASH_FEE_AUTHORITY_MAINNET = originals.main;
    if (originals.devnet === undefined) delete process.env.LEASH_FEE_AUTHORITY_DEVNET;
    else process.env.LEASH_FEE_AUTHORITY_DEVNET = originals.devnet;
  });

  it('falls back to the bundled defaults', () => {
    delete process.env.LEASH_FEE_AUTHORITY_MAINNET;
    delete process.env.LEASH_FEE_AUTHORITY_DEVNET;
    expect(resolveLeashFeeAuthority('mainnet')).toBe(LEASH_FEE_AUTHORITY_MAINNET_DEFAULT);
    expect(resolveLeashFeeAuthority('devnet')).toBe(LEASH_FEE_AUTHORITY_DEVNET_DEFAULT);
  });

  it('honours a per-network override', () => {
    process.env.LEASH_FEE_AUTHORITY_MAINNET = 'OverrideMainnet111111111111111111111111111';
    process.env.LEASH_FEE_AUTHORITY_DEVNET = 'OverrideDevnet1111111111111111111111111111';
    expect(resolveLeashFeeAuthority('mainnet')).toBe('OverrideMainnet111111111111111111111111111');
    expect(resolveLeashFeeAuthority('devnet')).toBe('OverrideDevnet1111111111111111111111111111');
  });
});

describe('resolveLeashFeeEnforcement', () => {
  const original = {
    g: process.env.LEASH_FEE_ENFORCE,
    m: process.env.LEASH_FEE_ENFORCE_MAINNET,
    d: process.env.LEASH_FEE_ENFORCE_DEVNET,
  };
  afterEach(() => {
    if (original.g === undefined) delete process.env.LEASH_FEE_ENFORCE;
    else process.env.LEASH_FEE_ENFORCE = original.g;
    if (original.m === undefined) delete process.env.LEASH_FEE_ENFORCE_MAINNET;
    else process.env.LEASH_FEE_ENFORCE_MAINNET = original.m;
    if (original.d === undefined) delete process.env.LEASH_FEE_ENFORCE_DEVNET;
    else process.env.LEASH_FEE_ENFORCE_DEVNET = original.d;
  });

  it('defaults to warn', () => {
    delete process.env.LEASH_FEE_ENFORCE;
    delete process.env.LEASH_FEE_ENFORCE_MAINNET;
    delete process.env.LEASH_FEE_ENFORCE_DEVNET;
    expect(resolveLeashFeeEnforcement('mainnet')).toBe('warn');
    expect(resolveLeashFeeEnforcement('devnet')).toBe('warn');
  });

  it('parses canonical values, falls back on garbage', () => {
    process.env.LEASH_FEE_ENFORCE = 'enforce';
    expect(resolveLeashFeeEnforcement('mainnet')).toBe('enforce');
    process.env.LEASH_FEE_ENFORCE = 'OFF';
    expect(resolveLeashFeeEnforcement('devnet')).toBe('off');
    process.env.LEASH_FEE_ENFORCE = 'something-weird';
    expect(resolveLeashFeeEnforcement('mainnet')).toBe('warn');
  });

  it('per-network override beats global', () => {
    process.env.LEASH_FEE_ENFORCE = 'off';
    process.env.LEASH_FEE_ENFORCE_MAINNET = 'enforce';
    expect(resolveLeashFeeEnforcement('mainnet')).toBe('enforce');
    expect(resolveLeashFeeEnforcement('devnet')).toBe('off');
  });
});

describe('buildLeashFeeExtra / parseLeashFeeExtra', () => {
  it('round-trips a synthetic extra block', () => {
    const built = buildLeashFeeExtra({ network: 'devnet' });
    const parsed = parseLeashFeeExtra({ 'leash.fee': built });
    expect(parsed).toEqual(built);
    expect(parsed?.v).toBe('1');
    expect(parsed?.bps).toBe(LEASH_FEE_BPS_DEFAULT);
    expect(parsed?.feeAuthority).toBe(LEASH_FEE_AUTHORITY_DEVNET_DEFAULT);
  });

  it('accepts custom bps + authority', () => {
    const built = buildLeashFeeExtra({
      network: 'mainnet',
      bps: 250,
      authority: 'CustomAuthority1111111111111111111111111111',
    });
    expect(built).toEqual({
      v: '1',
      bps: 250,
      feeAuthority: 'CustomAuthority1111111111111111111111111111',
    });
  });

  it('returns null for missing / wrong-shape inputs', () => {
    expect(parseLeashFeeExtra(null)).toBeNull();
    expect(parseLeashFeeExtra(undefined)).toBeNull();
    expect(parseLeashFeeExtra({})).toBeNull();
    expect(parseLeashFeeExtra({ 'leash.fee': null })).toBeNull();
    expect(parseLeashFeeExtra({ 'leash.fee': 'oops' as unknown })).toBeNull();
  });

  it('rejects malformed bps / authority', () => {
    expect(parseLeashFeeExtra({ 'leash.fee': { v: '1', bps: -1, feeAuthority: 'x' } })).toBeNull();
    expect(parseLeashFeeExtra({ 'leash.fee': { v: '1', bps: 1.5, feeAuthority: 'x' } })).toBeNull();
    expect(parseLeashFeeExtra({ 'leash.fee': { v: '1', bps: 100, feeAuthority: '' } })).toBeNull();
    expect(parseLeashFeeExtra({ 'leash.fee': { v: '2', bps: 100, feeAuthority: 'x' } })).toBeNull();
  });
});

describe('computeLeashFeeForRequirements', () => {
  it('returns null when extra is absent', async () => {
    const r = await computeLeashFeeForRequirements({
      network: 'devnet',
      asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      tokenProgram: 'spl-token',
      amount: '1000',
      extra: null,
    });
    expect(r).toBeNull();
  });

  it('derives the same triple buyer + facilitator will use', async () => {
    const extra: LeashFeeExtra = {
      v: '1',
      bps: 100,
      feeAuthority: LEASH_FEE_AUTHORITY_DEVNET_DEFAULT,
    };
    const r = await computeLeashFeeForRequirements({
      network: 'devnet',
      asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // devnet USDC
      tokenProgram: 'spl-token',
      amount: '1000000',
      extra,
    });
    expect(r).not.toBeNull();
    expect(r!.bps).toBe(100);
    expect(r!.feeAtomic).toBe(10_000n);
    expect(r!.grossAtomic).toBe(1_010_000n);
    expect(String(r!.feeAuthority)).toBe(LEASH_FEE_AUTHORITY_DEVNET_DEFAULT);
    expect(typeof String(r!.feeDestination)).toBe('string');
    expect(String(r!.feeDestination).length).toBeGreaterThan(0);
  });

  it('is deterministic across two calls with the same inputs', async () => {
    const extra: LeashFeeExtra = {
      v: '1',
      bps: 100,
      feeAuthority: LEASH_FEE_AUTHORITY_DEVNET_DEFAULT,
    };
    const args = {
      network: 'devnet' as const,
      asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      tokenProgram: 'spl-token' as const,
      amount: '12345',
      extra,
    };
    const a = await computeLeashFeeForRequirements(args);
    const b = await computeLeashFeeForRequirements(args);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(String(a!.feeDestination)).toBe(String(b!.feeDestination));
    expect(a!.feeAtomic).toBe(b!.feeAtomic);
    expect(a!.grossAtomic).toBe(b!.grossAtomic);
  });
});

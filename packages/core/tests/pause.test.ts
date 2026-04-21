import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPauseResolver, readPauseFromEnv } from '../src/treasury/pause.js';

describe('pause resolver', () => {
  const original = process.env.LEASH_KILL;
  beforeEach(() => {
    delete process.env.LEASH_KILL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.LEASH_KILL;
    else process.env.LEASH_KILL = original;
  });

  it('env breaker short-circuits onchain', async () => {
    process.env.LEASH_KILL = '1';
    expect(readPauseFromEnv()).toBe(true);
    const r = createPauseResolver({
      fetchOnchainPaused: vi.fn().mockResolvedValue(false),
    });
    const s = await r();
    expect(s).toEqual({ paused: true, source: 'env' });
  });

  it('caches onchain reads within ttl', async () => {
    let n = 0;
    const fetchOnchainPaused = vi.fn(async () => {
      n++;
      return n === 1;
    });
    const ts = { v: 0 };
    const r = createPauseResolver({
      fetchOnchainPaused,
      cacheTtlMs: 5000,
      now: () => ts.v,
    });
    expect((await r()).paused).toBe(true);
    ts.v = 4999;
    const cached = await r();
    expect(cached).toEqual({ paused: true, source: 'cache' });
    expect(fetchOnchainPaused).toHaveBeenCalledTimes(1);
    ts.v = 5001;
    const refreshed = await r();
    expect(refreshed.source).toBe('onchain');
    expect(refreshed.paused).toBe(false);
    expect(fetchOnchainPaused).toHaveBeenCalledTimes(2);
  });

  it('falls back to last-known on resolver error', async () => {
    let calls = 0;
    const r = createPauseResolver({
      fetchOnchainPaused: async () => {
        calls++;
        if (calls === 1) return true;
        throw new Error('rpc down');
      },
      cacheTtlMs: 0,
    });
    expect((await r()).paused).toBe(true);
    const s = await r();
    expect(s).toEqual({ paused: true, source: 'cache' });
  });

  it('returns false when no resolver and env unset', async () => {
    const r = createPauseResolver({});
    expect(await r()).toEqual({ paused: false, source: 'onchain' });
  });
});

/**
 * Redis client wrapper with a graceful in-memory fallback.
 *
 * In prod, set `LEASH_API_REDIS_URL` and the API uses Redis for
 * distributed rate-limiting, idempotency, and caching. In local dev /
 * single-process tests it's fine to leave it unset — the in-memory
 * implementation provides identical semantics for one process.
 */

import { Redis } from 'ioredis';

import type { LeashApiConfig } from '../config.js';

export type CacheClient = {
  /** Get raw string. */
  get(key: string): Promise<string | null>;
  /**
   * Set with TTL in seconds. Returns `true` if stored, `false` if key
   * already existed and `nx` was set.
   */
  set(key: string, value: string, opts: { ttlSec: number; nx?: boolean }): Promise<boolean>;
  /** Increment by 1. Returns the new value. */
  incr(key: string, opts: { ttlSec: number }): Promise<number>;
  /** Delete a key (no-op if missing). */
  del(key: string): Promise<void>;
  /** Best-effort close. */
  close(): Promise<void>;
};

class RedisCacheClient implements CacheClient {
  constructor(private readonly r: InstanceType<typeof Redis>) {}
  async get(key: string): Promise<string | null> {
    return this.r.get(key);
  }
  async set(key: string, value: string, opts: { ttlSec: number; nx?: boolean }): Promise<boolean> {
    const args: ['EX', number] = ['EX', opts.ttlSec];
    if (opts.nx) {
      const res = await this.r.set(key, value, ...args, 'NX');
      return res === 'OK';
    }
    const res = await this.r.set(key, value, ...args);
    return res === 'OK';
  }
  async incr(key: string, opts: { ttlSec: number }): Promise<number> {
    const pipeline = this.r.multi();
    pipeline.incr(key);
    pipeline.expire(key, opts.ttlSec, 'NX');
    const results = await pipeline.exec();
    const incrResult = results?.[0];
    if (incrResult == null || incrResult[0] != null) {
      throw new Error(`redis incr failed: ${String(incrResult?.[0])}`);
    }
    return Number(incrResult[1]);
  }
  async del(key: string): Promise<void> {
    await this.r.del(key);
  }
  async close(): Promise<void> {
    await this.r.quit().catch(() => undefined);
  }
}

/**
 * Process-local fallback. Same semantics as the Redis impl, scoped to
 * the current Node process. Suitable for tests, local dev, and CI.
 */
class MemoryCacheClient implements CacheClient {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();
  private now() {
    return Date.now();
  }
  private prune() {
    const now = this.now();
    for (const [k, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(k);
    }
  }
  async get(key: string): Promise<string | null> {
    this.prune();
    const entry = this.store.get(key);
    if (entry == null) return null;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key: string, value: string, opts: { ttlSec: number; nx?: boolean }): Promise<boolean> {
    this.prune();
    if (opts.nx && this.store.has(key)) {
      const cur = this.store.get(key)!;
      if (cur.expiresAt > this.now()) return false;
    }
    this.store.set(key, { value, expiresAt: this.now() + opts.ttlSec * 1_000 });
    return true;
  }
  async incr(key: string, opts: { ttlSec: number }): Promise<number> {
    this.prune();
    const entry = this.store.get(key);
    if (entry == null || entry.expiresAt <= this.now()) {
      this.store.set(key, { value: '1', expiresAt: this.now() + opts.ttlSec * 1_000 });
      return 1;
    }
    const next = Number(entry.value) + 1;
    entry.value = String(next);
    return next;
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
  async close(): Promise<void> {
    this.store.clear();
  }
}

let cached: CacheClient | null = null;

export function getCache(config: LeashApiConfig): CacheClient {
  if (cached != null) return cached;
  if (config.redisUrl == null) {
    cached = new MemoryCacheClient();
    return cached;
  }
  const r = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  // `lazyConnect: true` defers actual connection until the first command;
  // we surface the error there rather than at server boot so a Redis
  // outage during deploy doesn't block prepare/submit (in-memory fallback
  // is not auto-swapped — operators get a 5xx and clear log instead).
  cached = new RedisCacheClient(r);
  return cached;
}

export function _resetCacheForTests(): void {
  if (cached) {
    void cached.close();
  }
  cached = null;
}

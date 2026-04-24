/**
 * Per-API-key sliding-minute rate limiter.
 *
 * Each request increments a counter keyed by `(api_key_id, current
 * minute window)`. The counter expires after the minute is over, so the
 * keyspace stays bounded and we don't need a sweeper. Distributed via
 * Redis when configured; per-process Map otherwise.
 */

import type { CacheClient } from './redis.js';

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  used: number;
  resetSec: number;
};

function bucketKey(apiKeyId: string, nowMs: number): string {
  const minute = Math.floor(nowMs / 60_000);
  return `ratelimit:rpm:${apiKeyId}:${minute}`;
}

export async function checkRateLimit(
  cache: CacheClient,
  apiKeyId: string,
  rpm: number,
): Promise<RateLimitDecision> {
  const now = Date.now();
  const k = bucketKey(apiKeyId, now);
  // 90s TTL so the key survives until the minute fully rolls over even
  // if there's clock skew between API instances.
  const used = await cache.incr(k, { ttlSec: 90 });
  const resetSec = 60 - Math.floor((now / 1_000) % 60);
  return {
    allowed: used <= rpm,
    limit: rpm,
    used,
    resetSec,
  };
}

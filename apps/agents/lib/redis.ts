import { Redis } from 'ioredis';

import { getServerEnv } from './env';

let cached: Redis | null = null;

export function getRedisSubscriber(): Redis | null {
  const env = getServerEnv();
  if (!env.leashRedisUrl) return null;
  if (cached) return cached;
  cached = new Redis(env.leashRedisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  return cached;
}

/**
 * Open a NEW connection per SSE subscriber. Subscribing on a shared
 * connection puts it in subscribe-only mode and breaks reuse.
 */
export function createDedicatedSubscriber(): Redis | null {
  const env = getServerEnv();
  if (!env.leashRedisUrl) return null;
  return new Redis(env.leashRedisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });
}

/**
 * Idempotency-Key support. Backed by Redis (or the in-memory fallback)
 * with a 24-hour TTL. Lookup is scoped per `(api_key_id, path, key)` so
 * the same idempotency string can be reused across different routes
 * without collisions.
 */

import type { CacheClient } from './redis.js';

const IDEMPOTENCY_TTL_SEC = 24 * 60 * 60;

export type StoredIdempotentResponse = {
  status: number;
  body: unknown;
  /** ISO timestamp of when the original response was cached. */
  ts: string;
};

function key(apiKeyId: string, path: string, idempotencyKey: string): string {
  return `idempotency:${apiKeyId}:${path}:${idempotencyKey}`;
}

export async function lookupIdempotent(
  cache: CacheClient,
  apiKeyId: string,
  path: string,
  idempotencyKey: string,
): Promise<StoredIdempotentResponse | null> {
  const raw = await cache.get(key(apiKeyId, path, idempotencyKey));
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as StoredIdempotentResponse;
  } catch {
    return null;
  }
}

export async function storeIdempotent(
  cache: CacheClient,
  apiKeyId: string,
  path: string,
  idempotencyKey: string,
  response: { status: number; body: unknown },
): Promise<void> {
  const payload: StoredIdempotentResponse = {
    status: response.status,
    body: response.body,
    ts: new Date().toISOString(),
  };
  await cache.set(key(apiKeyId, path, idempotencyKey), JSON.stringify(payload), {
    ttlSec: IDEMPOTENCY_TTL_SEC,
  });
}

/**
 * API key authentication and per-key rate limiting middleware.
 *
 * Accepts the key via either `Authorization: Bearer <key>` or
 * `X-Api-Key: <key>`. The prefix encodes the network (`lsh_test_` =>
 * devnet, `lsh_live_` => mainnet); the resulting `network` is bound to
 * the request and used to scope every downstream operation, including
 * which RPC the API talks to.
 */

import type { Context, MiddlewareHandler } from 'hono';

import type { LeashApiConfig } from '../config.js';
import { networkFromKey } from '../config.js';
import { rateLimited, unauthorized, jsonError } from '../util/errors.js';
import { getApiKeyByPlaintext, type ApiKeyRecord } from '../storage/api-keys.js';
import { checkRateLimit } from '../storage/ratelimit.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import type { AuthVariables } from './types.js';

const KEY_CACHE_TTL_SEC = 60;
/** Slightly larger than KEY_CACHE_TTL_SEC so a revoke beats every still-warm cache entry. */
const REVOKED_FLAG_TTL_SEC = 90;

export type AuthDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

export function revokedFlagKey(id: string): string {
  return `cache:apikey:revoked:${id}`;
}

export async function markKeyRevoked(cache: CacheClient, id: string): Promise<void> {
  await cache.set(revokedFlagKey(id), '1', { ttlSec: REVOKED_FLAG_TTL_SEC });
}

function extractKey(c: Context): string | null {
  const auth = c.req.header('authorization');
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  const direct = c.req.header('x-api-key');
  return direct?.trim() || null;
}

async function lookupKey(deps: AuthDeps, plaintext: string): Promise<ApiKeyRecord | null> {
  const cacheKey = `cache:apikey:${plaintext}`;
  const cached = await deps.cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as Partial<ApiKeyRecord> & Pick<ApiKeyRecord, 'id'>;
      // Older cache entries may pre-date `owner_wallet` / `agent_mint`; coerce for a warm-cache window.
      return {
        ...parsed,
        ownerWallet: parsed.ownerWallet ?? null,
        agentMint: parsed.agentMint ?? null,
      } as ApiKeyRecord;
    } catch {
      // fall through and re-read from DB
    }
  }
  const fromDb = await getApiKeyByPlaintext(deps.db, plaintext);
  if (fromDb) {
    await deps.cache.set(cacheKey, JSON.stringify(fromDb), { ttlSec: KEY_CACHE_TTL_SEC });
  }
  return fromDb;
}

export function apiKeyAuth(deps: AuthDeps): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const raw = extractKey(c);
    if (!raw) return jsonError(c, unauthorized('missing api key'));

    let claimedNetwork: 'solana-devnet' | 'solana-mainnet';
    try {
      claimedNetwork = networkFromKey(raw);
    } catch (err) {
      return jsonError(c, unauthorized((err as Error).message));
    }

    const record = await lookupKey(deps, raw);
    if (!record) return jsonError(c, unauthorized('api key not recognized'));
    if (record.disabledAt != null) return jsonError(c, unauthorized('api key disabled'));
    // Cached record may pre-date a recent admin revoke (TTL is 60s).
    // The revoked flag is set by `POST /v1/admin/api-keys/{id}/disable`
    // and short-circuits any still-warm cache entry.
    const revoked = await deps.cache.get(revokedFlagKey(record.id));
    if (revoked) return jsonError(c, unauthorized('api key disabled'));
    if (record.network !== claimedNetwork) {
      return jsonError(c, unauthorized('api key network does not match its prefix'));
    }

    const decision = await checkRateLimit(deps.cache, record.id, deps.config.rateLimitRpm);
    c.header('X-RateLimit-Limit', String(decision.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, decision.limit - decision.used)));
    c.header('X-RateLimit-Reset', String(decision.resetSec));
    if (!decision.allowed) {
      return jsonError(c, rateLimited('per-key rate limit exceeded'));
    }

    c.set('apiKey', record);
    c.set('network', record.network);
    const clientRef = c.req.header('x-leash-client-ref');
    if (clientRef && clientRef.length > 0) c.set('clientReference', clientRef.slice(0, 256));
    await next();
  };
}

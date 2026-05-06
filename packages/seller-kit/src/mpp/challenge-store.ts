/**
 * In-memory store of issued MPP challenges with TTL.
 *
 * Sellers issue `MppChallengeV1.challengeId` on every 402 and must reject
 * a settled credential whose challengeId is unknown or expired (replay
 * protection). Production deployments should swap this for a shared store
 * (Redis / KV) — the interface is intentionally tiny so that's a one-file
 * change.
 *
 * The store is bounded; the oldest entries are evicted when capacity is
 * exceeded so an attacker cannot exhaust seller memory by spamming probes.
 */

import type { MppChallengeV1 } from '@leashmarket/schemas';

export type StoredChallenge = {
  challenge: MppChallengeV1;
  /** Route key (`'METHOD /path'`) the challenge was issued for. */
  routeKey: string;
  /** Issued-at, in milliseconds since epoch. */
  issuedAt: number;
  /** Set after a credential successfully settles — guards against double-spend. */
  consumed: boolean;
};

export type ChallengeStore = {
  put(challengeId: string, value: StoredChallenge): void;
  get(challengeId: string): StoredChallenge | null;
  consume(challengeId: string): StoredChallenge | null;
  size(): number;
};

export type ChallengeStoreOptions = {
  ttlMs?: number;
  capacity?: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CAPACITY = 10_000;

export function createInMemoryChallengeStore(opts: ChallengeStoreOptions = {}): ChallengeStore {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const map = new Map<string, StoredChallenge>();

  function evictExpired(now: number): void {
    for (const [k, v] of map) {
      if (now - v.issuedAt > ttl) map.delete(k);
    }
  }

  return {
    put(challengeId, value): void {
      const now = Date.now();
      evictExpired(now);
      while (map.size >= capacity) {
        const oldestKey = map.keys().next().value;
        if (oldestKey == null) break;
        map.delete(oldestKey);
      }
      map.set(challengeId, value);
    },
    get(challengeId): StoredChallenge | null {
      const v = map.get(challengeId);
      if (!v) return null;
      if (Date.now() - v.issuedAt > ttl) {
        map.delete(challengeId);
        return null;
      }
      return v;
    },
    consume(challengeId): StoredChallenge | null {
      const v = map.get(challengeId);
      if (!v) return null;
      if (Date.now() - v.issuedAt > ttl) {
        map.delete(challengeId);
        return null;
      }
      if (v.consumed) return null;
      v.consumed = true;
      return v;
    },
    size(): number {
      return map.size;
    },
  };
}

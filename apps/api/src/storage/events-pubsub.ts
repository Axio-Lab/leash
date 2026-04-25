/**
 * Live-event pub/sub fanout.
 *
 * The API publishes a tiny notification on every event lifecycle write
 * (prepared → submitted → confirmed/failed) and on every chain-ingested
 * row. The Explorer's SSE route subscribes per-network and pushes those
 * notifications to connected browsers, which then call
 * `router.refresh()` to revalidate the visible server-rendered tables.
 *
 * Why a notification instead of a snapshot?
 *   - Network payloads stay small (~150 bytes) regardless of how big
 *     the underlying event/receipt JSON gets.
 *   - The explorer is server-rendered with `force-dynamic`, so a
 *     refresh re-runs all SQL queries from scratch and the user sees
 *     the freshest data without us having to engineer per-page diff
 *     deltas.
 *   - Subscribers can still filter by `agent_asset` if they only want
 *     updates for a specific agent's feed.
 *
 * Why a separate module from `redis.ts`?
 *   - The CacheClient is a process-singleton; pub/sub subscribers MUST
 *     live on a dedicated Redis connection (once a connection issues
 *     SUBSCRIBE it can't accept other commands). Wrapping that detail
 *     in a small focused module keeps the cache surface clean.
 *   - The publisher can reuse the cache connection (PUBLISH is a
 *     one-shot command, not connection-state-changing), so we wire it
 *     in via {@link setEventPublisherCache} from boot rather than
 *     dragging the config into every `events.ts` write site.
 */

import { Redis } from 'ioredis';

import type { CacheClient } from './redis.js';
import type { EventRow } from './events.js';
import type { SvmNetwork } from '../util/network.js';

/**
 * Wire payload for live-event notifications. Kept small on purpose —
 * subscribers re-fetch full rows from the DB if they need richer data.
 */
export type LiveEventMessage = {
  /** Event row id (ULID). */
  id: string;
  /** Event kind, e.g. `'receipt.published'`, `'payment_link.settled'`. */
  kind: string;
  /** Lifecycle phase at the moment of publish. */
  phase: string;
  /** Network slug — also encoded in the channel name for routing. */
  network: SvmNetwork;
  /** Agent asset mint when the event is scoped to a specific agent. */
  agent: string | null;
  /** ISO timestamp from the underlying `events.ts` row. */
  ts: string;
};

let publisherCache: CacheClient | null = null;

/**
 * Boot wires the live-event publisher to the shared cache client.
 * Until this is called {@link publishLiveEvent} is a no-op so unit
 * tests that don't care about pub/sub stay zero-config.
 */
export function setEventPublisherCache(cache: CacheClient | null): void {
  publisherCache = cache;
}

/** Channel name for a given network. Stable, used by both sides. */
export function liveEventChannel(network: SvmNetwork): string {
  return `leash:events:${network}`;
}

/**
 * Best-effort publish of a single event row. Always swallows errors —
 * pub/sub plumbing must never fail the underlying API call. If Redis
 * is down, the explorer falls back to its periodic polling.
 */
export async function publishLiveEvent(row: EventRow): Promise<void> {
  if (publisherCache == null) return;
  const msg: LiveEventMessage = {
    id: row.id,
    kind: row.kind,
    phase: row.phase,
    network: row.network,
    agent: row.agentAsset,
    ts: row.ts,
  };
  try {
    await publisherCache.publish(liveEventChannel(row.network), JSON.stringify(msg));
  } catch {
    // intentionally swallowed
  }
}

/**
 * Subscriber handle returned by {@link createEventSubscriber}. Wraps a
 * dedicated Redis pub/sub connection (or the in-memory test bridge)
 * with simple subscribe/close semantics.
 */
export type EventSubscriber = {
  /**
   * Subscribe to live events on the given network. The handler is
   * invoked for every parsed message; non-conforming payloads are
   * dropped silently. Returns an unsubscribe function.
   */
  subscribe(
    network: SvmNetwork,
    handler: (msg: LiveEventMessage) => void,
  ): Promise<() => Promise<void>>;
  /** Close the underlying connection. Idempotent. */
  close(): Promise<void>;
};

/**
 * Create a fresh subscriber. When `redisUrl` is provided uses a
 * dedicated ioredis connection; otherwise falls back to the in-process
 * memory bridge (only useful when publisher + subscriber live in the
 * same Node process — i.e. unit tests).
 */
export async function createEventSubscriber(redisUrl?: string | null): Promise<EventSubscriber> {
  if (redisUrl) {
    // Static import (matches `redis.ts`) because Next.js bundling
    // rewrites dynamic `await import('ioredis')` in a way that loses
    // the `Redis` constructor. The cost is negligible — ioredis is
    // already a transitive dep of every consumer of `@leash/api`.
    const sub = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      // Keep the subscriber connection alive across transient
      // disconnects so SSE clients don't lose their stream.
      enableOfflineQueue: true,
    });
    await sub.connect();
    const channelHandlers = new Map<string, (msg: LiveEventMessage) => void>();
    sub.on('message', (channel: string, payload: string) => {
      const handler = channelHandlers.get(channel);
      if (!handler) return;
      try {
        const parsed = JSON.parse(payload) as LiveEventMessage;
        handler(parsed);
      } catch {
        // drop malformed
      }
    });
    return {
      async subscribe(network, handler) {
        const channel = liveEventChannel(network);
        channelHandlers.set(channel, handler);
        await sub.subscribe(channel);
        return async () => {
          channelHandlers.delete(channel);
          await sub.unsubscribe(channel).catch(() => undefined);
        };
      },
      async close() {
        channelHandlers.clear();
        await sub.quit().catch(() => undefined);
      },
    };
  }
  // In-memory fallback — used by unit tests where the publisher and
  // subscriber both run in the vitest process.
  const { _subscribeMemoryChannel } = await import('./redis.js');
  const unsubscribers: Array<() => void> = [];
  return {
    async subscribe(network, handler) {
      const channel = liveEventChannel(network);
      const off = _subscribeMemoryChannel(channel, (payload) => {
        try {
          const parsed = JSON.parse(payload) as LiveEventMessage;
          handler(parsed);
        } catch {
          // drop malformed
        }
      });
      unsubscribers.push(off);
      return async () => {
        off();
      };
    },
    async close() {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    },
  };
}

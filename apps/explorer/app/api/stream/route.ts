/**
 * Server-Sent Events stream of live API activity.
 *
 * The Explorer is a Next.js App Router site rendered with
 * `dynamic = 'force-dynamic'` — every server render reads straight from
 * the shared Turso DB. To get real-time updates without polling we
 * expose this endpoint, which:
 *
 *   1. Subscribes a fresh ioredis connection to `leash:events:{network}`
 *      (the channel the API publishes on after every event/receipt
 *      write — see `apps/api/src/storage/events-pubsub.ts`).
 *   2. Forwards each parsed message to the connected browser as an
 *      SSE `data:` frame.
 *   3. Sends a heartbeat comment every 15s so reverse proxies don't
 *      time the long-lived connection out.
 *   4. Cleans up the Redis subscriber on client disconnect (`AbortSignal`)
 *      and on explicit close.
 *
 * Behaviour when Redis is unavailable:
 *   - Without `LEASH_API_REDIS_URL` set, returns 503. The client-side
 *     hook treats that as "SSE unavailable, fall back to polling".
 *   - If Redis is reachable but the subscribe fails mid-stream we
 *     close with `event: error` so the client can reconnect with
 *     EventSource's built-in retry.
 */

import type { NextRequest } from 'next/server';
import { createEventSubscriber, type LiveEventMessage } from '@leashmarket/api';
import { isNetwork, networkToSlug, type Network } from '@/lib/network';

// Subscribers + heartbeats need Node primitives; Edge runtime is out.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// `Cache-Control: no-store` headers are also set below — Next normally
// honours them for `force-dynamic` routes but we belt-and-brace.
export const fetchCache = 'force-no-store';

const HEARTBEAT_MS = 15_000;

function networkFromQuery(req: NextRequest): Network {
  const raw = req.nextUrl.searchParams.get('network');
  if (raw && isNetwork(raw)) return raw;
  return 'devnet';
}

export async function GET(req: NextRequest): Promise<Response> {
  const network = networkFromQuery(req);
  const redisUrl = process.env.LEASH_API_REDIS_URL ?? null;
  if (!redisUrl) {
    // 503 — explicit "SSE not provisioned" so the client falls back
    // to its polling refresh path without retry-spamming the route.
    return new Response('SSE unavailable: LEASH_API_REDIS_URL is not set', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const encoder = new TextEncoder();
  const slug = networkToSlug(network);

  let unsubscribe: (() => Promise<void>) | null = null;
  let close: (() => Promise<void>) | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Open the subscriber lazily so an unreachable Redis turns into
      // an `event: error` frame the client can react to (rather than
      // a 500 the browser eats silently).
      try {
        const sub = await createEventSubscriber(redisUrl);
        close = () => sub.close();
        // Initial comment flushes headers immediately so EventSource
        // transitions from CONNECTING → OPEN without waiting for the
        // first real message.
        controller.enqueue(encoder.encode(`: connected to ${slug}\n\n`));
        controller.enqueue(
          encoder.encode(`event: ready\ndata: ${JSON.stringify({ network })}\n\n`),
        );
        unsubscribe = await sub.subscribe(slug, (msg: LiveEventMessage) => {
          try {
            // Use the event id as the SSE id so EventSource's
            // `Last-Event-ID` reconnect header carries it. We don't
            // use it server-side today but it makes future replay
            // implementations trivial.
            controller.enqueue(encoder.encode(`id: ${msg.id}\ndata: ${JSON.stringify(msg)}\n\n`));
          } catch {
            // controller already closed — disconnect cleanup will run
          }
        });
        heartbeatId = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: hb\n\n`));
          } catch {
            // controller already closed
          }
        }, HEARTBEAT_MS);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'subscribe failed';
        try {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
          );
        } catch {
          // ignore
        }
        controller.close();
      }
    },
    async cancel() {
      if (heartbeatId) clearInterval(heartbeatId);
      heartbeatId = null;
      try {
        if (unsubscribe) await unsubscribe();
      } catch {
        // ignore
      }
      try {
        if (close) await close();
      } catch {
        // ignore
      }
    },
  });

  // Wire the request abort signal to the stream cancel so a navigated-
  // away tab releases its Redis subscriber promptly.
  req.signal.addEventListener('abort', () => {
    void stream.cancel().catch(() => undefined);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Disable nginx buffering so each frame reaches the browser
      // immediately (no-op on dev, important behind a proxy).
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Background webhook delivery worker.
 *
 * Tick:
 *   1. Pull a batch of due `webhook_deliveries` (delivered=0,
 *      next_attempt_at <= now).
 *   2. For each delivery:
 *        - load the parent webhook subscription (skip if disabled)
 *        - HMAC-sign the payload with the subscription secret
 *        - POST to the URL with a short timeout
 *        - 2xx => mark delivered; non-2xx / network error => bump
 *          `attempts` and reschedule with exponential backoff
 *   3. After `MAX_ATTEMPTS`, mark delivered=1 with `last_status=-1`
 *      so the row stops being retried (operators see it via
 *      /v1/webhooks/{id}/deliveries).
 *
 * Designed to run in-process for dev / single-node setups. Multi-node
 * deployments should add a SELECT ... FOR UPDATE SKIP LOCKED pattern
 * (Turso/SQLite doesn't support it; in production we use a Redis lease).
 */

import type { DbClient } from '../storage/turso.js';
import {
  getWebhookById,
  listDuePending,
  markDelivered,
  markDeliveryFailed,
} from '../storage/webhooks.js';
import { signPayload } from './sign.js';

export type WorkerOptions = {
  /** Delivery timeout per HTTP attempt. Defaults to 8 seconds. */
  timeoutMs?: number;
  /** Maximum attempts before giving up. Defaults to 8 (~30 min total). */
  maxAttempts?: number;
  /** How many deliveries to process per tick. Defaults to 25. */
  batchSize?: number;
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BATCH_SIZE = 25;

export type TickResult = {
  processed: number;
  delivered: number;
  failed: number;
};

export async function runWebhookTick(
  db: DbClient,
  options: WorkerOptions = {},
): Promise<TickResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const httpFetch = options.fetchImpl ?? fetch;

  const due = await listDuePending(db, batchSize);
  let delivered = 0;
  let failed = 0;
  for (const delivery of due) {
    const sub = await getWebhookById(db, delivery.webhookId);
    if (!sub || sub.disabledAt != null) {
      // Subscription is gone or disabled — short-circuit so we stop
      // retrying.
      await markDelivered(db, delivery.id, 410);
      delivered += 1;
      continue;
    }
    const sig = signPayload(sub.secret, delivery.payloadJson);
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let res: Response;
      try {
        res = await httpFetch(sub.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-leash-signature': sig.header,
            'x-leash-event': 'event',
            'x-leash-delivery': delivery.id,
          },
          body: delivery.payloadJson,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 200 && res.status < 300) {
        await markDelivered(db, delivery.id, res.status);
        delivered += 1;
      } else {
        await scheduleRetry(
          db,
          delivery.id,
          delivery.attempts + 1,
          maxAttempts,
          res.status,
          `http ${res.status}`,
        );
        failed += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await scheduleRetry(db, delivery.id, delivery.attempts + 1, maxAttempts, null, message);
      failed += 1;
    }
  }
  return { processed: due.length, delivered, failed };
}

async function scheduleRetry(
  db: DbClient,
  id: string,
  newAttempts: number,
  maxAttempts: number,
  status: number | null,
  error: string,
): Promise<void> {
  if (newAttempts >= maxAttempts) {
    // Stop trying — flag as delivered with a sentinel status so the
    // row falls out of the worker's queue but operators can still see
    // the failure history in /v1/webhooks/{id}/deliveries.
    await markDeliveryFailed(
      db,
      id,
      status,
      `${error} (giving up after ${maxAttempts} attempts)`,
      isoNow(),
    );
    await markDelivered(db, id, status ?? -1);
    return;
  }
  const delaySeconds = backoffSeconds(newAttempts);
  await markDeliveryFailed(db, id, status, error, isoSecondsFromNow(delaySeconds));
}

function isoNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function isoSecondsFromNow(seconds: number): string {
  const d = new Date(Date.now() + seconds * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Exponential backoff: 5s, 25s, 2m, 10m, 50m, ... capped at 1h. */
export function backoffSeconds(attempt: number): number {
  const base = Math.min(60 * 60, Math.pow(5, Math.min(attempt, 6)));
  return Math.max(5, Math.floor(base));
}

export type WorkerHandle = {
  stop: () => void;
};

/**
 * Loop the tick on an interval until `stop()` is called. Designed for
 * `dev.ts` and integration tests; production runs the worker in a
 * dedicated process via the CLI.
 */
export function startWebhookWorker(
  db: DbClient,
  intervalMs = 2_000,
  options: WorkerOptions = {},
): WorkerHandle {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await runWebhookTick(db, options);
    } catch {
      // swallow — keep the worker alive
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return {
    stop: () => {
      stopped = true;
    },
  };
}

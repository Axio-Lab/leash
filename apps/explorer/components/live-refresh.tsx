'use client';

/**
 * Smart live-refresh pill — SSE-first with polling fallback.
 *
 * Design goals:
 *  - When the API publishes to Redis pub/sub (`apps/api/src/storage/
 *    events-pubsub.ts`), every event/receipt write reaches the
 *    Explorer in <50ms via this component's EventSource and triggers
 *    a debounced `router.refresh()`. The user sees "live · stream".
 *  - When SSE is unavailable (no Redis configured, transient drop,
 *    older browser), we transparently fall back to the same polling
 *    cadence the old `<AutoRefresh />` used. The user sees "live · 5s".
 *  - Pause works in both modes — useful when reading a snapshot.
 *  - Tab visibility is respected in both modes (no DB queries while
 *    the tab is in the background).
 *
 * Implementation notes:
 *  - We bind to `/api/stream?network=<slug>`. Network is passed in as
 *    a prop because the layout already resolved it server-side from
 *    cookies; the client doesn't need to read cookies again.
 *  - SSE messages are coalesced through a 250ms debounce. A burst of
 *    receipt + event writes for the same payment becomes one refresh.
 *  - The component must be resilient against EventSource's automatic
 *    reconnect storms (server restart, redis blip). We treat any
 *    `onerror` while CONNECTING as "permanently broken" and switch to
 *    polling; transient errors mid-stream just get retried.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Network } from '@/lib/network';

type Props = {
  /** Resolved devnet|mainnet for the SSE channel. */
  network: Network;
  /** Polling-fallback interval (s). Defaults to 5 — matches the old
   * `<AutoRefresh />` used everywhere prior. */
  intervalSec?: number;
  label?: string;
};

type Mode = 'connecting' | 'sse' | 'polling';

const REFRESH_DEBOUNCE_MS = 250;

export function LiveRefresh({ network, intervalSec = 5, label = 'live' }: Props) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<Mode>('connecting');
  const [countdown, setCountdown] = useState(intervalSec);

  // Refs so we never re-mount listeners on every render. Mutating them
  // is fine — only the visible state above triggers React updates.
  const intervalSecRef = useRef(intervalSec);
  intervalSecRef.current = intervalSec;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const refreshDebounceRef = useRef<number | null>(null);

  const triggerRefresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (pausedRef.current) return;
    if (refreshDebounceRef.current != null) return;
    refreshDebounceRef.current = window.setTimeout(() => {
      refreshDebounceRef.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (cancelled) return;
      setMode('polling');
      let remaining = intervalSecRef.current;
      setCountdown(remaining);
      pollIntervalId = setInterval(() => {
        if (cancelled) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        remaining -= 1;
        if (remaining <= 0) {
          triggerRefresh();
          remaining = intervalSecRef.current;
        }
        setCountdown(remaining);
      }, 1_000);
    };

    const startSse = () => {
      if (cancelled) return;
      // EventSource isn't available in SSR — guard for safety even
      // though this whole effect runs client-only.
      if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
        startPolling();
        return;
      }
      setMode('connecting');
      try {
        es = new EventSource(`/api/stream?network=${network}`);
      } catch {
        startPolling();
        return;
      }
      // The server emits a custom `event: ready` frame as the first
      // payload after the channel is wired up — that's our "SSE is
      // healthy" signal. Until we see it we stay in 'connecting'.
      es.addEventListener('ready', () => {
        if (cancelled) return;
        setMode('sse');
      });
      es.addEventListener('error', () => {
        // EventSource fires `error` for any non-OK HTTP status (e.g.
        // 503 when LEASH_API_REDIS_URL is unset) AND for transient
        // network blips after a successful open. We distinguish:
        //   - Still CONNECTING (readyState 0 or 2) → permanent fall
        //     back to polling so we don't spam reconnect attempts.
        //   - Already OPEN (readyState 1) → let EventSource handle
        //     its built-in reconnect; we just briefly show 'connecting'.
        if (!es) return;
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          startPolling();
        } else {
          setMode('connecting');
        }
      });
      es.onmessage = () => {
        if (cancelled) return;
        triggerRefresh();
      };
    };

    startSse();

    return () => {
      cancelled = true;
      if (es) {
        es.close();
        es = null;
      }
      if (pollIntervalId) clearInterval(pollIntervalId);
      if (refreshDebounceRef.current != null) {
        clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
    };
  }, [network, paused, triggerRefresh]);

  const dotClass = paused
    ? 'bg-[--color-fg-subtle]'
    : mode === 'connecting'
      ? 'bg-[--color-warning] motion-safe:animate-pulse'
      : 'bg-[--color-success] motion-safe:animate-pulse';

  let detail: React.ReactNode;
  if (paused) {
    detail = (
      <span className="font-mono uppercase tracking-wider text-[--color-fg-subtle]">paused</span>
    );
  } else if (mode === 'sse') {
    detail = (
      <span
        className="font-mono uppercase tracking-wider text-[--color-fg-subtle]"
        title="Streaming via Server-Sent Events"
      >
        stream
      </span>
    );
  } else if (mode === 'polling') {
    detail = (
      <span
        className="font-mono tabular-nums text-[--color-fg-subtle]"
        title={`Polling every ${intervalSec}s — SSE unavailable`}
      >
        ⟲ {countdown}s
      </span>
    );
  } else {
    detail = <span className="font-mono uppercase tracking-wider text-[--color-fg-subtle]">…</span>;
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-2.5 py-1 text-xs text-[--color-fg-muted] backdrop-blur-md">
      <span className="relative inline-flex items-center" aria-hidden="true">
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', dotClass)} />
        {!paused && mode !== 'connecting' ? (
          <span
            className={cn(
              'absolute inset-0 inline-flex h-1.5 w-1.5 rounded-full opacity-60 motion-safe:animate-ping',
              mode === 'sse' ? 'bg-[--color-success]' : 'bg-[--color-warning]',
            )}
          />
        ) : null}
      </span>
      <span className="font-mono uppercase tracking-wider text-[--color-fg-subtle]">{label}</span>
      {detail}
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="inline-flex items-center justify-center rounded-md border border-[--color-border] bg-[--color-bg-elev-2]/60 p-1 text-[--color-fg-muted] transition-colors hover:border-[--color-border-strong] hover:text-[--color-fg]"
        aria-label={paused ? 'Resume live refresh' : 'Pause live refresh'}
        title={paused ? 'Resume live refresh' : 'Pause live refresh'}
      >
        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      </button>
    </span>
  );
}

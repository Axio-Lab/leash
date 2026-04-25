'use client';

/**
 * Live-refresh pill for server-rendered explorer pages.
 *
 * The page itself is a Server Component with `dynamic = 'force-dynamic'`
 * (so each render reads straight from the DB). This component just
 * pings the App Router's refresh hook on a fixed interval, which causes
 * Next to re-run the server component without a hard navigation —
 * scroll position, route, and search params all survive.
 *
 * Behavior:
 *  - Pauses while the tab is hidden (no point burning DB queries when
 *    the user isn't looking).
 *  - "Pause" button so a reader can freeze a snapshot they're inspecting.
 *  - Tiny countdown so it's obvious the page is alive without being
 *    visually noisy.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  /** Interval in seconds. Defaults to 5s — long enough to avoid hammering
   * the DB, short enough that "live" feels real on devnet/testing. */
  intervalSec?: number;
  /** Optional label shown next to the indicator. */
  label?: string;
};

export function AutoRefresh({ intervalSec = 5, label = 'live' }: Props) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState(intervalSec);
  const intervalSecRef = useRef(intervalSec);
  intervalSecRef.current = intervalSec;

  useEffect(() => {
    if (paused) return;
    let remaining = intervalSecRef.current;
    setCountdown(remaining);
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        router.refresh();
        remaining = intervalSecRef.current;
      }
      setCountdown(remaining);
    };
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [paused, router]);

  return (
    <span className="inline-flex items-center gap-2 text-xs text-[--color-fg-muted]">
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          paused ? 'bg-[--color-fg-subtle]' : 'bg-[--color-success] motion-safe:animate-pulse',
        )}
        aria-hidden="true"
      />
      <span className="font-mono uppercase tracking-wider text-[--color-fg-subtle]">{label}</span>
      {!paused ? (
        <span className="font-mono tabular-nums text-[--color-fg-subtle]">{countdown}s</span>
      ) : (
        <span className="font-mono uppercase tracking-wider text-[--color-fg-subtle]">paused</span>
      )}
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="inline-flex items-center justify-center rounded-md border border-[--color-border] bg-[--color-bg-elev] p-1 text-[--color-fg-muted] hover:text-[--color-fg] transition-colors"
        aria-label={paused ? 'Resume live refresh' : 'Pause live refresh'}
        title={paused ? 'Resume live refresh' : 'Pause live refresh'}
      >
        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      </button>
    </span>
  );
}

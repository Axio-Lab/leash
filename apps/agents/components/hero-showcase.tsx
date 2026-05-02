'use client';

/**
 * Self-driving demo of an agent's task lifecycle. Mirrors the state
 * machine in `apps/agent-runtime/src/executor.ts` (think → tool_call →
 * payment → tool_result → done) so the landing page shows a believable
 * preview of what `agent.leash.market` actually produces at runtime.
 *
 * Hover anywhere on the panel to pause; click "replay" to restart from
 * the first step. Treasury balance ticks down as `payment` rows land
 * and resets at the end of each loop.
 */

import { useEffect, useRef, useState } from 'react';

type StepType = 'think' | 'tool_call' | 'payment' | 'tool_result' | 'done';

type Step = {
  type: StepType;
  title: string;
  detail: string;
  cost?: number;
  delay: number;
};

type Event = Step & { id: number; ts: string };

const STARTING_BALANCE = 12.5;

const SCRIPT: readonly Step[] = [
  {
    type: 'think',
    title: 'reasoning',
    detail: 'Plan: search news, then top up phone with USDC.',
    delay: 1300,
  },
  {
    type: 'tool_call',
    title: 'web_search',
    detail: 'mcp://search.leash.market',
    delay: 1100,
  },
  {
    type: 'payment',
    title: 'x402 settle',
    detail: '0.001 USDC · solana-devnet',
    cost: 0.001,
    delay: 1100,
  },
  {
    type: 'tool_result',
    title: 'web_search',
    detail: 'ok · 24 results · 412ms',
    delay: 900,
  },
  {
    type: 'tool_call',
    title: 'airtime_topup',
    detail: 'mcp://reloadly.leash.market',
    delay: 1200,
  },
  {
    type: 'payment',
    title: 'x402 settle',
    detail: '5.000 USDC · solana-devnet',
    cost: 5,
    delay: 1200,
  },
  {
    type: 'tool_result',
    title: 'airtime_topup',
    detail: 'ok · receipt rt_8a2f…',
    delay: 1000,
  },
  {
    type: 'done',
    title: 'final answer',
    detail: 'Topped up +233·24·123·… with $5 USDC.',
    delay: 2400,
  },
] as const;

function nowHHMMSS(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function HeroShowcase() {
  const [events, setEvents] = useState<Event[]>([]);
  const [paused, setPaused] = useState(false);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [tickKey, setTickKey] = useState(0);
  const stepRef = useRef(0);
  const idRef = useRef(0);
  const lastEmittedRef = useRef(-1);

  useEffect(() => {
    if (paused) return;
    const step = SCRIPT[stepRef.current % SCRIPT.length]!;

    if (lastEmittedRef.current !== tickKey) {
      lastEmittedRef.current = tickKey;
      const ev: Event = { ...step, id: idRef.current++, ts: nowHHMMSS() };
      setEvents((prev) => [ev, ...prev].slice(0, 6));
      if (typeof step.cost === 'number') {
        setBalance((b) => Math.max(b - step.cost!, 0));
      }
    }

    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      if (step.type === 'done') setBalance(STARTING_BALANCE);
      stepRef.current += 1;
      setTickKey((k) => k + 1);
    }, step.delay);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [tickKey, paused]);

  const handleReplay = (): void => {
    setEvents([]);
    setBalance(STARTING_BALANCE);
    stepRef.current = 0;
    lastEmittedRef.current = -1;
    setTickKey((k) => k + 1);
  };

  const stepLabel = `${(stepRef.current % SCRIPT.length) + 1}/${SCRIPT.length}`;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-bg-elev/70 backdrop-blur-xl shadow-[0_30px_120px_-30px_rgba(0,0,0,0.6)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-danger/70" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-success/70" />
        </div>
        <div className="flex-1 truncate text-center text-[11px] font-mono text-fg-subtle">
          agent · 7Hk9…u4Pq · solana-devnet
        </div>
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-success">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          {paused ? 'paused' : 'live'}
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-border border-b">
        <Stat
          label="status"
          value={paused ? 'paused' : 'running'}
          accent={paused ? 'warning' : 'success'}
        />
        <Stat label="treasury" value={`$${balance.toFixed(3)}`} accent="brand" mono />
        <Stat label="step" value={stepLabel} mono />
      </div>

      <div className="relative flex min-h-[340px] flex-col gap-2 p-4">
        {events.length === 0 ? (
          <div className="py-12 text-center text-[11px] font-mono text-fg-subtle">
            waiting for first task…
          </div>
        ) : (
          events.map((e, i) => (
            <ActivityRow
              key={e.id}
              event={e}
              active={i === 0}
              dim={i / Math.max(events.length, 1)}
            />
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t px-4 py-3 text-[10px] font-mono uppercase tracking-[0.2em] text-fg-subtle">
        <span>hover to pause</span>
        <button
          type="button"
          onClick={handleReplay}
          className="rounded border px-2 py-1 normal-case tracking-normal text-fg-muted transition hover:border-border-strong hover:text-fg"
        >
          replay
        </button>
      </div>
    </div>
  );
}

type Accent = 'brand' | 'success' | 'warning' | 'danger';

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: Accent;
}): React.ReactElement {
  const accentClass: string =
    accent === 'brand'
      ? 'text-brand'
      : accent === 'success'
        ? 'text-success'
        : accent === 'warning'
          ? 'text-warning'
          : accent === 'danger'
            ? 'text-danger'
            : 'text-fg';
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-fg-subtle">{label}</div>
      <div className={`mt-1 ${mono ? 'font-mono' : ''} text-base ${accentClass} tabular-nums`}>
        {value}
      </div>
    </div>
  );
}

const TYPE_META: Record<StepType, { label: string; tone: string; bar: string }> = {
  think: { label: 'think', tone: 'text-fg-muted', bar: 'bg-fg-muted/40' },
  tool_call: { label: 'tool_call', tone: 'text-brand', bar: 'bg-brand/60' },
  payment: { label: 'payment', tone: 'text-warning', bar: 'bg-warning/60' },
  tool_result: { label: 'tool_result', tone: 'text-success', bar: 'bg-success/60' },
  done: { label: 'done', tone: 'text-success', bar: 'bg-success' },
};

function ActivityRow({
  event,
  active,
  dim,
}: {
  event: Event;
  active: boolean;
  dim: number;
}): React.ReactElement {
  const meta = TYPE_META[event.type];
  return (
    <div
      className="flex items-stretch gap-3 rounded-md border bg-bg-elev/60 px-3 py-2.5 animate-row-in"
      style={{ opacity: 1 - dim * 0.55 }}
    >
      <div className={`w-[3px] rounded-full ${meta.bar}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono uppercase tracking-[0.18em] ${meta.tone}`}>
            {meta.label}
          </span>
          <span className="truncate text-sm font-medium">{event.title}</span>
          {active ? (
            <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-fg-subtle">
              <span className="size-1.5 rounded-full bg-success animate-pulse" />
              now
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[12px] font-mono text-fg-muted">{event.detail}</div>
      </div>
      <div className="flex flex-col items-end justify-between text-[10px] font-mono text-fg-subtle">
        <span>{event.ts}</span>
        {typeof event.cost === 'number' ? (
          <span className="text-warning">−${event.cost.toFixed(3)}</span>
        ) : null}
      </div>
    </div>
  );
}

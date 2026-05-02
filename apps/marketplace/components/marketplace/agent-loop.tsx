'use client';

import * as React from 'react';
import { motion } from 'motion/react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * Agent-perspective trace for the marketplace hero. Streams an autonomous
 * loop — plan, match, pay, call, verify, receipt — like an inference log,
 * not a creator dashboard. One accent (brand) on neutral mono; no emojis,
 * no status colour-coding beyond a pulsed brand dot.
 */

type Step = {
  kind: string;
  label: string;
  body: string;
};

const STEPS: readonly Step[] = [
  { kind: 'plan', label: 'plan', body: '"current sol price with citations, last 5 minutes"' },
  { kind: 'match', label: 'match', body: 'premium-search · per-call · 0.001 USDC' },
  { kind: 'auth', label: 'auth', body: 'x402 → solana-devnet · signed' },
  { kind: 'call', label: 'call', body: 'POST /mcp/tools/search · 200 OK · 0.42s' },
  { kind: 'verify', label: 'verify', body: '8 sources · ranked · cited' },
  { kind: 'receipt', label: 'receipt', body: 'tx 3xQk…b9P2 · allow · chained' },
] as const;

const STEP_MS = 1100;
const PAUSE_STEPS = 3; // hold the completed loop briefly before restarting
const CYCLE = STEPS.length + PAUSE_STEPS;

export function AgentLoop({ className }: { className?: string }) {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const phase = tick % CYCLE;
  const visible = Math.min(phase, STEPS.length);
  const looped = Math.floor(tick / CYCLE);

  const calls = 142 + looped * STEPS.length + visible;
  const spent = (calls * 0.001).toFixed(3);

  return (
    <Card className={cn('relative overflow-hidden p-0', className)}>
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute -top-40 left-1/2 h-72 w-[140%] -translate-x-1/2 rounded-full bg-linear-to-b from-brand/30 via-brand/5 to-transparent blur-3xl" />
      <div className="relative px-5 pb-5 pt-4">
        <div className="mb-3 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.18em] text-fg-subtle">
          <span>agent.trace</span>
          <span className="flex items-center gap-1.5 text-fg-muted">
            <span className="size-1.5 rounded-full bg-brand animate-pulse" />
            running
          </span>
        </div>

        <div className="h-[244px] overflow-hidden rounded-md border bg-bg p-3 font-mono text-[12px] leading-[1.55]">
          {STEPS.slice(0, visible).map((s, i) => (
            <motion.div
              key={`${looped}-${s.kind}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="flex items-baseline gap-3 py-0.5"
            >
              <span className="w-9 shrink-0 text-fg-subtle">{String(i + 1).padStart(2, '0')}</span>
              <span className="w-16 shrink-0 lowercase text-brand-strong">{s.label}</span>
              <span className="text-fg-muted">{s.body}</span>
            </motion.div>
          ))}
          {visible < STEPS.length ? (
            <div className="flex items-baseline gap-3 py-0.5">
              <span className="w-9 shrink-0 text-fg-subtle">
                {String(visible + 1).padStart(2, '0')}
              </span>
              <motion.span
                initial={{ opacity: 0.2 }}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="text-fg-subtle"
              >
                ▍
              </motion.span>
            </div>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="calls" value={String(calls)} />
          <Stat label="spent" value={`$${spent}`} />
          <Stat label="latency" value="0.42s" />
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-bg-elev/60 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-fg">{value}</div>
    </div>
  );
}

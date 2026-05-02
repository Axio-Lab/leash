'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, FileJson, Sparkles, Tag, Wallet } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * Animated story for "Building an MCP? Drop in your leash-mcp.json,
 * set a price, and start collecting USDC from autonomous buyers within
 * minutes."
 *
 * The simulator advances through six steps on a 24s loop:
 *   1. drop the manifest    (json appears in the editor pane)
 *   2. price it             (per-call USDC amount lands)
 *   3. publish              (status flips approved)
 *   4. buyer agent arrives  (left rail lights up)
 *   5. tool runs             (request → response in centre pane)
 *   6. settle in USDC        (right rail bumps balance and emits a receipt)
 *
 * Pure CSS animations + motion. No external timers; visibility-pause
 * is handled by `prefers-reduced-motion` in CSS.
 */
const STEPS = [
  { id: 'manifest', label: 'Drop manifest' },
  { id: 'price', label: 'Set price' },
  { id: 'publish', label: 'Publish' },
  { id: 'buyer', label: 'Agent buys' },
  { id: 'execute', label: 'Tool runs' },
  { id: 'settle', label: 'USDC settles' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

export function McpSimulation() {
  const [step, setStep] = React.useState(0);
  const [usdc, setUsdc] = React.useState(0);
  const [calls, setCalls] = React.useState(0);

  React.useEffect(() => {
    const t = setInterval(() => {
      setStep((s) => {
        const next = (s + 1) % STEPS.length;
        if (next === 5) {
          setUsdc((u) => +(u + 0.012).toFixed(3));
          setCalls((c) => c + 1);
        }
        return next;
      });
    }, 2400);
    return () => clearInterval(t);
  }, []);

  const at = (id: StepId) => STEPS[step].id === id;
  const past = (id: StepId) => STEPS.findIndex((s) => s.id === id) <= step;

  return (
    <Card className="relative overflow-hidden border-border bg-bg-elev/70 p-0">
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute -top-32 left-1/2 h-64 w-[120%] -translate-x-1/2 rounded-full bg-gradient-to-b from-brand/30 via-brand/5 to-transparent blur-3xl" />
      <div className="relative grid gap-0 lg:grid-cols-[200px_minmax(0,1fr)_220px]">
        {/* Steps rail */}
        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div className="text-[10px] uppercase tracking-widest text-fg-subtle">
            Live simulation
          </div>
          <ol className="mt-3 space-y-2.5 text-sm">
            {STEPS.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid size-5 place-items-center rounded-full border text-[10px] font-medium transition-colors',
                    i < step
                      ? 'border-brand/60 bg-brand/15 text-brand-strong'
                      : i === step
                        ? 'border-brand bg-brand text-white shadow-[0_0_0_4px_oklch(0.66_0.19_268/0.18)]'
                        : 'border-border text-fg-subtle',
                  )}
                >
                  {i < step ? <CheckCircle2 className="size-3" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'transition-colors',
                    i === step ? 'text-fg' : i < step ? 'text-fg-muted' : 'text-fg-subtle',
                  )}
                >
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Centre stage */}
        <div className="relative min-h-[320px] p-5 lg:p-6">
          <AnimatePresence mode="wait">
            {at('manifest') ? (
              <Stage key="manifest">
                <StageHeader icon={<FileJson className="size-4" />} label="leash-mcp.json" />
                <ManifestEditor />
              </Stage>
            ) : at('price') ? (
              <Stage key="price">
                <StageHeader icon={<Tag className="size-4" />} label="Set per-call price" />
                <PriceCard />
              </Stage>
            ) : at('publish') ? (
              <Stage key="publish">
                <StageHeader
                  icon={<Sparkles className="size-4" />}
                  label="Publish to leash.market"
                />
                <PublishCard />
              </Stage>
            ) : at('buyer') ? (
              <Stage key="buyer">
                <StageHeader
                  icon={<Sparkles className="size-4" />}
                  label="Autonomous buyer found you"
                />
                <BuyerCard />
              </Stage>
            ) : at('execute') ? (
              <Stage key="execute">
                <StageHeader icon={<Sparkles className="size-4" />} label="Tool runs" />
                <ExecuteCard />
              </Stage>
            ) : (
              <Stage key="settle">
                <StageHeader icon={<Wallet className="size-4" />} label="USDC settled on-chain" />
                <SettleCard usdc={usdc} />
              </Stage>
            )}
          </AnimatePresence>
        </div>

        {/* Right rail: counters + receipts */}
        <div className="border-t border-border p-4 lg:border-t-0 lg:border-l lg:p-5">
          <div className="space-y-4">
            <Stat label="Lifetime calls" value={String(calls)} loud={past('execute')} />
            <Stat label="USDC collected" value={`$${usdc.toFixed(3)}`} loud={past('settle')} />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-fg-subtle">
                Latest receipt
              </div>
              <div
                className={cn(
                  'mt-2 rounded-md border bg-bg p-2.5 text-[10px] leading-relaxed font-mono transition-opacity',
                  past('settle') ? 'opacity-100' : 'opacity-40',
                )}
              >
                <div className="text-fg-muted">
                  decision <span className="text-emerald-300">allow</span>
                </div>
                <div className="text-fg-muted">
                  price <span className="text-fg">$0.012 USDC</span>
                </div>
                <div className="text-fg-muted">
                  tx <span className="text-brand-strong">3xQk…b9P2</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="space-y-4"
    >
      {children}
    </motion.div>
  );
}

function StageHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-fg-muted">
      <span className="text-brand-strong">{icon}</span>
      <span className="text-xs uppercase tracking-widest">{label}</span>
    </div>
  );
}

function ManifestEditor() {
  const lines = [
    `{`,
    `  "name": "Premium Web Search",`,
    `  "slug": "premium-search",`,
    `  "description": "50M curated sources",`,
    `  "endpoint": "https://search.demo.leash.market/mcp",`,
    `  "pricing": { "type": "per_call", "amount": "0.001", "currency": "USDC" },`,
    `  "tools": [{ "name": "search", "description": "..." }]`,
    `}`,
  ];
  return (
    <pre className="overflow-hidden rounded-md border bg-bg p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.06 }}
          className={cn(
            line.includes('"name"') && 'text-fg',
            line.includes('"endpoint"') && 'text-brand-strong',
          )}
        >
          {line}
        </motion.div>
      ))}
    </pre>
  );
}

function PriceCard() {
  return (
    <div className="rounded-md border bg-bg p-4">
      <div className="flex items-baseline gap-2">
        <motion.span
          key="amount"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          className="font-mono text-3xl font-semibold text-fg"
        >
          $0.001
        </motion.span>
        <span className="text-xs text-fg-muted">USDC / call</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <Badge variant="outline">x402</Badge>
        <Badge variant="outline">solana-devnet</Badge>
        <Badge variant="outline">free tier: 100/day</Badge>
      </div>
    </div>
  );
}

function PublishCard() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-md border bg-bg p-4 text-center"
    >
      <div className="text-xs text-fg-muted">Status</div>
      <div className="mt-2 flex items-center justify-center gap-2 text-lg font-semibold text-emerald-300">
        <CheckCircle2 className="size-5" /> Approved
      </div>
      <div className="mt-2 text-xs text-fg-subtle">
        leash.market/listing/<span className="font-mono">premium-search</span>
      </div>
    </motion.div>
  );
}

function BuyerCard() {
  return (
    <div className="rounded-md border bg-bg p-4 text-sm">
      <div className="text-xs uppercase tracking-widest text-fg-subtle">Incoming request</div>
      <div className="mt-2 font-mono text-xs text-fg-muted">
        <div>POST /mcp/tools/search</div>
        <div className="text-emerald-300">x-payment: x402-solana-devnet …</div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Badge variant="default">agent_3F…</Badge>
        <span className="text-xs text-fg-muted">running policy v0.1</span>
      </div>
    </div>
  );
}

function ExecuteCard() {
  return (
    <div className="rounded-md border bg-bg p-4 font-mono text-[11px] leading-relaxed text-fg-muted">
      <div className="text-emerald-300">{'>'} payment verified</div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        {'>'} tools.search(query: &quot;sol price&quot;)
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        {'>'} 200 OK · <span className="text-fg">8 sources · 0.42s</span>
      </motion.div>
    </div>
  );
}

function SettleCard({ usdc }: { usdc: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-md border bg-bg p-4">
        <div className="text-xs text-fg-muted">Settled</div>
        <div className="font-mono text-2xl font-semibold text-emerald-300">+$0.012</div>
        <div className="text-[10px] text-fg-subtle">tx 3xQk…b9P2</div>
      </div>
      <motion.div
        key={usdc}
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="rounded-md border bg-bg p-4"
      >
        <div className="text-xs text-fg-muted">Balance</div>
        <div className="font-mono text-2xl font-semibold text-fg">${usdc.toFixed(3)}</div>
        <div className="text-[10px] text-fg-subtle">creator wallet</div>
      </motion.div>
    </div>
  );
}

function Stat({ label, value, loud }: { label: string; value: string; loud: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-fg-subtle">{label}</div>
      <motion.div
        key={value}
        initial={{ scale: 0.96 }}
        animate={{ scale: 1 }}
        className={cn(
          'mt-1 font-mono text-2xl font-semibold transition-colors',
          loud ? 'text-fg' : 'text-fg-muted',
        )}
      >
        {value}
      </motion.div>
    </div>
  );
}

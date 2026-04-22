'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Activity,
  ShoppingBag,
  Send,
  Bot,
  FileJson2,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { jsonFetcher } from '@/lib/fetcher';

type PauseRes = {
  paused?: boolean;
  source?: 'env' | 'onchain' | 'cache';
  env_kill?: boolean;
  error?: string;
};

const QUICKLINKS = [
  {
    href: '/runner',
    icon: Activity,
    title: 'Runner',
    desc: 'Live `receipts.jsonl` for any agent.',
  },
  {
    href: '/seller',
    icon: ShoppingBag,
    title: 'Seller playground',
    desc: 'Hit a paid route with the x402 gate.',
  },
  {
    href: '/buyer',
    icon: Send,
    title: 'Buyer playground',
    desc: 'Build RulesV1, fire a request, see the receipt.',
  },
  { href: '/agents', icon: Bot, title: 'Agents', desc: 'Browse & open agent profiles.' },
  {
    href: '/schemas',
    icon: FileJson2,
    title: 'Schemas',
    desc: 'Validate payloads against the live Zod schemas.',
  },
];

export default function DashboardPage() {
  const { data: pause } = useSWR<PauseRes>('/api/runner/pause', jsonFetcher, {
    refreshInterval: 5000,
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Playground"
        title="Leash control room"
        description="An open rail for agents that spend on the open internet. One place to drive the runner, agents, sellers, buyers, and the schemas they share."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <KillSwitchCard pause={pause} />
        <StatCard
          title="Runner endpoint"
          value="LEASH_RUNNER_URL"
          hint="Configured in .env.local"
          tone="default"
        />
        <StatCard
          title="Network"
          value="Solana devnet"
          hint="Switch via NEXT_PUBLIC_SOLANA_RPC"
          tone="default"
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-fg-subtle">Jump in</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {QUICKLINKS.map((q) => {
            const Icon = q.icon;
            return (
              <Link key={q.href} href={q.href} className="group">
                <Card className="h-full transition-colors hover:border-border-strong hover:bg-bg-elev">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <Icon className="size-5 text-brand" />
                      <ArrowRight className="size-4 text-fg-subtle group-hover:text-fg group-hover:translate-x-0.5 transition" />
                    </div>
                    <CardTitle>{q.title}</CardTitle>
                    <CardDescription>{q.desc}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-fg-subtle">
          Get up & running
        </h2>
        <Card>
          <CardContent className="pt-5 grid gap-4 md:grid-cols-3">
            <Step n="1" title="Run the runner">
              <code className="text-xs">pnpm --filter @leash/runner start</code>
              <p className="text-xs text-fg-subtle mt-1">
                Exposes <span className="font-mono">/health</span>,{' '}
                <span className="font-mono">/pause</span>, and{' '}
                <span className="font-mono">/a/:mint/receipts.jsonl</span> on{' '}
                <span className="font-mono">:8787</span>.
              </p>
            </Step>
            <Step n="2" title="Run a seller">
              <code className="text-xs">pnpm --filter @leash/seller-demo start</code>
              <p className="text-xs text-fg-subtle mt-1">
                Or use the built-in{' '}
                <Link href="/seller" className="text-brand hover:underline">
                  seller playground
                </Link>{' '}
                which exposes <span className="font-mono">/api/seller/echo</span>.
              </p>
            </Step>
            <Step n="3" title="Drive a buyer">
              <p className="text-xs text-fg-subtle">
                Build a <span className="font-mono">RulesV1</span> doc in the{' '}
                <Link href="/buyer" className="text-brand hover:underline">
                  buyer playground
                </Link>{' '}
                and fire a request. The returned receipt mirrors what the runner stores.
              </p>
            </Step>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function KillSwitchCard({ pause }: { pause?: PauseRes }) {
  if (!pause) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>Kill-switch</CardDescription>
          <CardTitle className="flex items-center gap-2 text-fg-muted">
            <span className="size-2 rounded-full bg-fg-subtle" />
            checking…
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }
  if (pause.error) {
    return (
      <Card className="border-danger/40">
        <CardHeader>
          <CardDescription>Kill-switch</CardDescription>
          <CardTitle className="flex items-center gap-2 text-danger">
            <ShieldAlert className="size-4" /> runner unreachable
          </CardTitle>
          <p className="text-xs text-fg-muted">{pause.error}</p>
        </CardHeader>
      </Card>
    );
  }
  if (pause.paused) {
    return (
      <Card className="border-warning/40">
        <CardHeader>
          <CardDescription>Kill-switch</CardDescription>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-warning" />
            Paused
            <Badge variant="warning">{pause.source}</Badge>
          </CardTitle>
          <p className="text-xs text-fg-muted">
            Set <code className="font-mono">LEASH_KILL=0</code> (or unpause on-chain) to resume.
          </p>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardDescription>Kill-switch</CardDescription>
        <CardTitle className="flex items-center gap-2 text-success">
          <CheckCircle2 className="size-4" />
          Live
          <Badge variant="success">source: {pause.source}</Badge>
        </CardTitle>
        <p className="text-xs text-fg-muted">
          env_kill = <span className="font-mono">{String(pause.env_kill)}</span>
        </p>
      </CardHeader>
    </Card>
  );
}

function StatCard({
  title,
  value,
  hint,
  tone: _tone,
}: {
  title: string;
  value: string;
  hint?: string;
  tone: 'default';
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="font-mono text-sm text-fg">{value}</CardTitle>
        {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full border border-border bg-bg-elev-2 text-[11px] font-semibold text-fg-muted">
          {n}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="rounded-md border border-border bg-bg-elev p-3 text-sm">{children}</div>
    </div>
  );
}

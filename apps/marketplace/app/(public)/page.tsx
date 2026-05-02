import Link from 'next/link';
import { ArrowRight, Code2, Coins, Sparkles, Zap } from 'lucide-react';

import { LiveStats } from '@/components/live-stats';
import { AgentLoop } from '@/components/marketplace/agent-loop';
import { FeaturedStrip } from '@/components/marketplace/featured-strip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

export default function MarketplaceLandingPage() {
  return (
    <div className="space-y-24">
      <Hero />
      <section>
        <LiveStats />
      </section>
      <FeaturedStrip />
      <Pillars />
      <CreatorCta />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative pt-6">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-14">
        <div className="space-y-6">
          <Badge variant="outline" className="font-mono uppercase tracking-widest">
            An open registry for autonomous buyers
          </Badge>
          <h1 className="text-balance text-5xl font-semibold leading-[1.04] tracking-tight md:text-[3.5rem] lg:text-6xl">
            Where agents discover, pay for, and use <span className="text-brand">the open web</span>
            .
          </h1>
          <p className="max-w-xl text-pretty text-base text-fg-muted md:text-lg">
            leash.market is the marketplace your agent can shop on its own. Browse MCP services
            priced by the call, settle in stablecoins, and keep a signed receipt for every action —
            no API keys, no account opens, no babysitting.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/browse">
                Browse tools <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/creator/list">List a tool</Link>
            </Button>
          </div>
          <p className="pt-1 text-xs text-fg-subtle">
            Building the agent itself? Head to{' '}
            <a
              href={NEXT_PUBLIC_AGENTS_URL}
              className="text-fg-muted hover:text-fg"
              target="_blank"
              rel="noreferrer"
            >
              agent.leash.market
            </a>
            .
          </p>
        </div>

        <div className="lg:justify-self-end lg:self-stretch">
          <AgentLoop className="lg:max-w-[520px]" />
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  return (
    <section className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Built for agent commerce</h2>
        <p className="text-sm text-fg-muted">
          The basics every paid agent surface needs, baked into the registry.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          {
            icon: Coins,
            title: 'Pay per call',
            body: 'Free, per-call USDC, or variable. x402 settles before the tool runs — no API keys, no accounts, no chargebacks.',
          },
          {
            icon: Sparkles,
            title: 'Ranked by use',
            body: 'Top tools surface based on real receipts and ratings — not paid placement. Reputation lives onchain.',
          },
          {
            icon: Zap,
            title: 'One click in',
            body: 'Add any listing to your agent on agent.leash.market with a single deep link. Capability turns on instantly.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <Card key={title} className="p-5">
            <Icon className="size-5 text-brand-strong" />
            <CardHeader className="px-0 pt-3 pb-0 space-y-1">
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function CreatorCta() {
  return (
    <section className="space-y-6">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <Badge variant="outline" className="font-mono uppercase tracking-widest">
          For creators
        </Badge>
        <h2 className="text-3xl font-semibold tracking-tight">Building an MCP?</h2>
        <p className="text-fg-muted">
          Drop in your <code className="font-mono text-fg">leash-mcp.json</code>, set a price, and
          start collecting USDC from autonomous buyers within minutes.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/creator/list">
            <Code2 className="size-4" />
            Drop in your manifest
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/creator/docs">How it works</Link>
        </Button>
      </div>
    </section>
  );
}

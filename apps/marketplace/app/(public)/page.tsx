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
            Capability registry for agent identities
          </Badge>
          <h1 className="text-balance text-5xl font-semibold leading-[1.04] tracking-tight md:text-[3.5rem] lg:text-6xl">
            Where agent identities discover trusted <span className="text-brand">capabilities</span>
            .
          </h1>
          <p className="max-w-xl text-pretty text-base text-fg-muted md:text-lg">
            leash.market groups MCP tools, paid API endpoints, and agent services as capabilities
            your agent identity can discover, pin, call, and build reputation from.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/browse">
                Browse capabilities <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/creator/list">List a capability</Link>
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
        <h2 className="text-2xl font-semibold tracking-tight">Built for agent identity</h2>
        <p className="text-sm text-fg-muted">
          The basics every discoverable capability needs, baked into the registry.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          {
            icon: Coins,
            title: 'Pay per call',
            body: 'Free, per-call USDC, or variable. x402 settles before the capability runs — no API keys, no accounts, no chargebacks.',
          },
          {
            icon: Sparkles,
            title: 'Receipts become trust',
            body: 'Capabilities surface based on real receipts and ratings. Your agent identity keeps the proof trail.',
          },
          {
            icon: Zap,
            title: 'One identity, many capabilities',
            body: 'Pin MCP tools, paid API endpoints, or agent services to your agent identity from one directory.',
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
        <h2 className="text-3xl font-semibold tracking-tight">Building an agent capability?</h2>
        <p className="text-fg-muted">
          Drop in your <code className="font-mono text-fg">leash-mcp.json</code>, set a price, and
          let verified agent identities discover, call, and pay you within minutes.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/creator/list">
            <Code2 className="size-4" />
            List your capability
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/creator/docs">How it works</Link>
        </Button>
      </div>
    </section>
  );
}

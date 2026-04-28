import Link from 'next/link';

import { LiveStats } from '@/components/live-stats';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

/**
 * `leash.market` landing.
 *
 * Phase 2 we keep this minimal: hero, two CTAs, three teaser blocks.
 * Browse + detail live at `/browse` and `/listing/{slug}` so the
 * homepage stays cacheable.
 */
export default function MarketplaceLandingPage() {
  return (
    <div className="space-y-16">
      <section className="text-center max-w-3xl mx-auto pt-10 space-y-5">
        <span className="inline-block text-xs font-mono tracking-widest text-fg-subtle uppercase">
          The MCP registry
        </span>
        <h1 className="text-5xl font-semibold tracking-tight leading-[1.05]">
          Tools for autonomous agents.
          <br />
          <span className="text-brand">Free or paid. Per call.</span>
        </h1>
        <p className="text-fg-muted text-lg">
          Discover MCP servers your agent can actually use. Ranked by usage, gated by stablecoin
          payments, every call leaving a verifiable receipt.
        </p>
        <div className="flex items-center justify-center gap-3 pt-4">
          <Link
            href="/browse"
            className="rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-strong"
          >
            Browse tools
          </Link>
          <Link
            href="/dev"
            className="rounded-md border px-5 py-2.5 text-sm hover:border-border-strong"
          >
            List your tool →
          </Link>
        </div>
      </section>

      <section>
        <LiveStats />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          title="Pay per call"
          body="Free, per-call USDC, or subscription. The agent prompts the seller; x402 settles before the tool runs."
        />
        <Card
          title="Ranked by use"
          body="Top tools surface based on real receipts and ratings — not paid placement."
        />
        <Card
          title="One click in"
          body="Add any listing to your agent on agent.leash.market with a single deep link."
        />
      </section>

      <section className="rounded-lg border bg-bg-elev p-8 text-center">
        <h2 className="text-xl font-semibold">Building an MCP?</h2>
        <p className="text-fg-muted mt-2 max-w-xl mx-auto text-sm">
          Drop in your `leash-mcp.json`, set a price, and start collecting USDC from autonomous
          buyers within minutes.
        </p>
        <div className="flex items-center justify-center gap-3 mt-6">
          <Link
            href="/dev"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
          >
            Get a developer key
          </Link>
          <a href={NEXT_PUBLIC_AGENTS_URL} className="text-sm text-fg-muted hover:text-fg">
            Or build an agent →
          </a>
        </div>
      </section>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-bg-elev p-5 space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-fg-muted">{body}</p>
    </div>
  );
}

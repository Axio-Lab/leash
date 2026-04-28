'use client';

import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome.</h1>
        <p className="text-fg-muted mt-1">
          Mint your first agent, then fund it and give it a task.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          title="Create an API key"
          desc="Generate an lsh_* key to call Leash from your scripts or the agent runtime."
          href="/settings/api-keys"
          cta="Manage keys"
        />
        <Card
          title="Mint an agent"
          desc="A guided chat that picks tools, sets a budget, and mints an MPL Core asset."
          href="/agents/new"
          cta="Create agent"
        />
        <Card
          title="Fund and run"
          desc="Top up your agent's treasury with USDC and watch it work, live."
          href="/agents"
          cta="Your agents"
        />
      </div>
    </div>
  );
}

function Card({
  title,
  desc,
  href,
  cta,
}: {
  title: string;
  desc: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border bg-bg-elev p-4 hover:border-border-strong transition-colors block"
    >
      <div className="font-medium">{title}</div>
      <div className="text-sm text-fg-muted mt-1">{desc}</div>
      <div className="text-sm text-brand mt-3">{cta} →</div>
    </Link>
  );
}

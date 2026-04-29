'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, Code2, KeyRound, PackagePlus, Sparkles, Wallet } from 'lucide-react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

import { McpSimulation } from '@/components/marketplace/mcp-simulation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{
    items: Array<{ id: string; status: string; pricing: { type: string } }>;
  }>;
};

export default function CreatorOverviewPage() {
  const { user } = usePrivy();
  const privyId = (user as { id?: string } | null)?.id ?? '';
  const { data, isLoading } = useSWR(
    privyId ? `/api/listings?owner_privy_id=${encodeURIComponent(privyId)}` : null,
    fetcher,
  );
  const items = data?.items ?? [];
  const totals = {
    total: items.length,
    pending: items.filter((l) => l.status === 'pending').length,
    live: items.filter((l) => l.status === 'approved').length,
    paid: items.filter((l) => l.pricing.type !== 'free').length,
  };

  const greeting =
    user?.email?.address ??
    (user?.wallet?.address
      ? `${user.wallet.address.slice(0, 4)}…${user.wallet.address.slice(-4)}`
      : 'creator');

  return (
    <div className="space-y-10 max-w-[1100px]">
      {/* Hero / animated simulator */}
      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Badge variant="outline" className="font-mono uppercase tracking-widest">
              Welcome, {greeting}
            </Badge>
            <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
              Building an MCP?
            </h1>
            <p className="mt-2 max-w-xl text-fg-muted">
              Drop in your{' '}
              <code className="rounded bg-bg-elev px-1.5 py-0.5 font-mono text-fg">
                leash-mcp.json
              </code>
              , set a price, and start collecting USDC from autonomous buyers within minutes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/creator/list">
                <Sparkles className="size-4" /> Drop in your manifest
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/creator/snippets">
                <Code2 className="size-4" /> Get the seller kit
              </Link>
            </Button>
          </div>
        </div>

        <McpSimulation />
      </section>

      {/* Numbers */}
      <section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Listings" value={totals.total} loading={isLoading} />
          <Stat label="Live" value={totals.live} loading={isLoading} accent="emerald" />
          <Stat label="Pending" value={totals.pending} loading={isLoading} accent="amber" />
          <Stat label="Paid tools" value={totals.paid} loading={isLoading} accent="brand" />
        </div>
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ActionCard
          icon={PackagePlus}
          title="List a tool"
          body="Paste your manifest URL or hand-build one. We validate, you approve, agents discover."
          href="/creator/list"
        />
        <ActionCard
          icon={Code2}
          title="Make any API x402-compliant"
          body="Drop the seller-kit middleware into Hono / Express / FastAPI. Payment in front of your handler in minutes."
          href="/creator/snippets"
        />
        <ActionCard
          icon={KeyRound}
          title="Issue an API key"
          body="lsh_* keys with marketplace scope to manage your listings programmatically."
          href="/creator/api-keys"
        />
      </section>

      {/* Earnings + how it works */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-brand-strong" />
              <CardTitle>Earnings (preview)</CardTitle>
            </div>
            <CardDescription>
              Per-call USDC settlement lands directly in your wallet. Charts arrive next batch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-dashed bg-bg-elev/40 p-8 text-center text-sm text-fg-muted">
              No receipts yet. Buyers settle on-chain on first paid call.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-brand-strong" />
              <CardTitle>How leash.market works</CardTitle>
            </div>
            <CardDescription>Three steps from idea to a paid agent capability.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Step n={1} title="Drop your manifest">
              Host <code className="font-mono text-fg">/.well-known/leash-mcp.json</code> on your
              endpoint. We'll fetch it, validate it, and prefill the listing.
            </Step>
            <Step n={2} title="Set a price">
              Free, per-call USDC, or variable. Free tier gives autonomous buyers a chance to try
              your tool risk-free.
            </Step>
            <Step n={3} title="Wrap your handler">
              Paste the seller-kit snippet so x402 settles before your code runs. Receipts post
              automatically.
            </Step>
            <div className="pt-2">
              <Button asChild variant="link" className="px-0">
                <Link href="/creator/docs">
                  Read the full guide <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: number;
  loading: boolean;
  accent?: 'emerald' | 'amber' | 'brand';
}) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-widest text-fg-subtle">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <div
          className={
            'mt-1 font-mono text-3xl font-semibold ' +
            (accent === 'emerald'
              ? 'text-emerald-300'
              : accent === 'amber'
                ? 'text-amber-300'
                : accent === 'brand'
                  ? 'text-brand-strong'
                  : 'text-fg')
          }
        >
          {value}
        </div>
      )}
    </Card>
  );
}

function ActionCard({
  icon: Icon,
  title,
  body,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <Card className="group flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:border-border-strong">
      <Icon className="size-5 text-brand-strong" />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 flex-1 text-sm text-fg-muted">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-strong group-hover:underline"
      >
        Open <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full border bg-bg text-xs font-mono text-fg-muted">
        {n}
      </span>
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-fg-muted">{children}</p>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { use } from 'react';
import { AlertTriangle, ArrowLeft, BookOpen, ExternalLink, ShieldCheck } from 'lucide-react';
import useSWR from 'swr';

import { StarRating } from '@/components/ratings';
import { ReviewBlock } from '@/components/review-form';
import { ToolsTable, type Tool } from '@/components/tools-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { capabilityCount, capabilityCountHint } from '@/lib/capabilities';
import { NEXT_PUBLIC_AGENTS_URL, NEXT_PUBLIC_EXPLORER_URL } from '@/lib/env';

type Listing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricing: { type: string; amount?: string; currency?: string };
  tools: Tool[];
  docs_url: string | null;
  free_tier: number;
  health_status: 'ok' | 'warn' | 'down' | null;
  status: string;
  seller_agent_mint: string | null;
  seller_identity: PublicIdentitySummary | null;
};

type PublicIdentitySummary = {
  mint: string;
  network: 'solana-devnet' | 'solana-mainnet';
  handle: string | null;
  name: string;
  verified_domains: string[];
  reputation: { settled_calls: number; denied_calls: number; rating: number };
  capability_cards_count: number;
  claims_count: number;
};

type IdentityVerificationDecision = {
  verdict: 'allow' | 'warn' | 'deny';
  resolved_mint: string | null;
  network: 'solana-devnet' | 'solana-mainnet' | null;
  score: number;
  checks: Array<{
    name: string;
    passed: boolean;
    severity: 'info' | 'warn' | 'deny';
    detail: string;
  }>;
  profile: PublicIdentitySummary | null;
};

const json = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export default function ListingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, error, isLoading } = useSWR<{
    listing: Listing;
    rating: { avg: number; count: number };
    identity_verification: IdentityVerificationDecision | null;
  }>(`/api/listings/by-slug/${slug}`, json);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (error) {
    return <div className="text-danger">{(error as Error).message}</div>;
  }
  if (!data) return null;

  const isFree = data.listing.pricing.type === 'free';
  const addHref = `${NEXT_PUBLIC_AGENTS_URL}/settings/favorites?${new URLSearchParams({
    source: 'leash',
    q: data.listing.name || data.listing.slug,
  }).toString()}`;
  const count = capabilityCount({ source: 'leash', tools: data.listing.tools });
  const countHint = capabilityCountHint({ source: 'leash', tools: data.listing.tools });

  return (
    <div className="space-y-8">
      <Link
        href="/browse"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Back to browse
      </Link>

      <article className="space-y-8">
        <header className="space-y-4 rounded-xl border bg-aurora p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono uppercase">
              {data.listing.category}
            </Badge>
            <Badge variant={isFree ? 'free' : 'paid'}>
              {isFree
                ? 'Free'
                : `${data.listing.pricing.amount ?? '?'} ${data.listing.pricing.currency ?? 'USDC'} / call`}
            </Badge>
            {data.listing.free_tier > 0 ? (
              <Badge variant="secondary">Free tier · {data.listing.free_tier}/day</Badge>
            ) : null}
          </div>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
            {data.listing.name}
          </h1>
          <p className="max-w-2xl text-pretty text-fg-muted">{data.listing.description}</p>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
            <StarRating value={data.rating.avg} count={data.rating.count} />
            <span className="text-fg-subtle">
              {count} capabilit{count === 1 ? 'y' : 'ies'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link href={addHref}>Add capability</Link>
            </Button>
            {data.listing.docs_url ? (
              <Button variant="outline" asChild>
                <a href={data.listing.docs_url} target="_blank" rel="noreferrer">
                  <BookOpen className="size-4" /> Docs
                </a>
              </Button>
            ) : null}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Capabilities</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-fg-subtle">{countHint}</p>
              <ToolsTable tools={data.listing.tools} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Endpoint</CardTitle>
            </CardHeader>
            <CardContent>
              <code className="block break-all rounded-md border bg-bg p-3 font-mono text-xs text-fg-muted">
                {data.listing.endpoint}
              </code>
              <p className="mt-3 text-xs text-fg-subtle">
                Agent identities call this URL via x402. Payment is settled per capability call
                before the upstream handler runs.
              </p>
            </CardContent>
          </Card>
        </div>

        <SellerIdentityPanel
          identity={data.listing.seller_identity}
          decision={data.identity_verification}
        />

        <ReviewBlock listingId={data.listing.id} />
      </article>
    </div>
  );
}

function SellerIdentityPanel({
  identity,
  decision,
}: {
  identity: PublicIdentitySummary | null;
  decision: IdentityVerificationDecision | null;
}) {
  if (!identity) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-300" />
            <CardTitle>Seller identity</CardTitle>
          </div>
          <CardDescription>
            This is a legacy marketplace listing without a linked Leash seller identity yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-muted">
            The capability remains browsable, but agents should treat it as unverified until the
            creator links an onchain agent identity.
          </p>
        </CardContent>
      </Card>
    );
  }

  const explorerHref = `${NEXT_PUBLIC_EXPLORER_URL.replace(/\/+$/, '')}/agent/${identity.mint}`;
  const verdictTone =
    decision?.verdict === 'allow'
      ? 'text-emerald-300'
      : decision?.verdict === 'deny'
        ? 'text-rose-300'
        : 'text-amber-300';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-300" />
              <CardTitle>Seller identity</CardTitle>
            </div>
            <CardDescription>
              Linked seller identity, reputation, and capability trust checks.
            </CardDescription>
          </div>
          {decision ? (
            <Badge variant="outline" className={`font-mono uppercase ${verdictTone}`}>
              {decision.verdict} · {decision.score}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <IdentityMetric
            label="Agent"
            value={identity.handle ? `@${identity.handle}` : identity.name}
          />
          <IdentityMetric label="Network" value={identity.network.replace('solana-', '')} />
          <IdentityMetric label="Reputation" value={identity.reputation.rating.toFixed(4)} />
          <IdentityMetric
            label="Proof"
            value={`${identity.capability_cards_count} cards · ${identity.claims_count} claims`}
          />
        </div>
        <div className="rounded-lg border bg-bg p-3">
          <div className="text-xs font-medium uppercase tracking-widest text-fg-subtle">
            Verified domains
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {identity.verified_domains.length === 0 ? (
              <span className="text-sm text-fg-muted">No public verified domains yet</span>
            ) : (
              identity.verified_domains.map((domain) => (
                <Badge key={domain} variant="secondary">
                  {domain}
                </Badge>
              ))
            )}
          </div>
        </div>
        {decision?.checks.length ? (
          <ul className="divide-y divide-border rounded-lg border text-sm">
            {decision.checks.map((check) => (
              <li key={check.name} className="flex items-start justify-between gap-3 px-3 py-2">
                <div>
                  <div className="font-medium">{check.name.replaceAll('_', ' ')}</div>
                  <p className="text-xs text-fg-muted">{check.detail}</p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    check.passed
                      ? 'text-emerald-300'
                      : check.severity === 'deny'
                        ? 'text-rose-300'
                        : 'text-amber-300'
                  }
                >
                  {check.passed ? 'ok' : check.severity}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <Button variant="outline" asChild>
          <a href={explorerHref} target="_blank" rel="noreferrer">
            View identity in explorer <ExternalLink className="size-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function IdentityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-bg p-3">
      <div className="text-[11px] font-medium uppercase tracking-widest text-fg-subtle">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

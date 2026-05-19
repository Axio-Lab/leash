'use client';

import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import useSWR from 'swr';

import { StarRating } from '@/components/ratings';
import { ReviewBlock } from '@/components/review-form';
import { ToolsTable, type Tool } from '@/components/tools-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

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
              {data.listing.tools.length} capabilit{data.listing.tools.length === 1 ? 'y' : 'ies'}
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

        <ReviewBlock listingId={data.listing.id} />
      </article>
    </div>
  );
}

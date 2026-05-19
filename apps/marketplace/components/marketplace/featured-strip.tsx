'use client';

import Link from 'next/link';
import useSWR from 'swr';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type Listing = {
  id: string;
  source?: 'leash' | 'pay-skills';
  slug: string;
  name: string;
  description: string;
  category: string;
  pricing: { type: string; amount?: string; currency?: string };
  tools: Array<{ name: string }>;
  endpoint_count?: number;
  rating?: { avg: number; count: number };
};

type DiscoverItem = {
  source: 'leash' | 'pay-skills';
  url: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
  rating: number | null;
  endpoint_count?: number;
  tools: Array<{ name: string }>;
};

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ items: DiscoverItem[] }>);

function normalizeListing(item: DiscoverItem): Listing {
  return {
    id: `${item.source}:${item.slug}`,
    source: item.source,
    slug: item.slug,
    name: item.title,
    description: item.description,
    category: item.category || 'misc',
    pricing: {
      type: item.pricing_type,
      ...(item.price_usdc ? { amount: item.price_usdc, currency: 'USDC' } : {}),
    },
    tools: item.tools ?? [],
    ...(typeof item.endpoint_count === 'number' ? { endpoint_count: item.endpoint_count } : {}),
    ...(typeof item.rating === 'number' ? { rating: { avg: item.rating * 5, count: 1 } } : {}),
  };
}

/**
 * Featured capabilities strip on the public landing. Pulls the merged
 * Leash + pay.sh discovery feed and renders it as compact cards.
 */
export function FeaturedStrip() {
  const { data, isLoading } = useSWR<{ items: DiscoverItem[] }>(
    '/api/discover?source=all&limit=6',
    fetcher,
  );
  const items = (data?.items ?? []).map(normalizeListing);

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-fg-subtle">Trending</p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Capabilities agents are reaching for today
          </h2>
        </div>
        <Link href="/browse" className="text-sm text-fg-muted hover:text-fg">
          Browse all →
        </Link>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-fg-muted">
          No capabilities yet. Be the first to{' '}
          <Link href="/creator/list" className="text-brand hover:underline">
            list one
          </Link>
          .
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 6).map((l) => (
            <FeaturedCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeaturedCard({ listing }: { listing: Listing }) {
  const isFree = listing.pricing.type === 'free';
  const source = listing.source ?? 'leash';
  const detailHref =
    source === 'pay-skills' ? `/capability/pay-skills/${listing.slug}` : `/listing/${listing.slug}`;
  const capabilityCount = listing.endpoint_count ?? listing.tools.length;

  return (
    <Link
      href={detailHref}
      className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong"
    >
      <div className="absolute inset-x-0 -top-32 h-32 bg-gradient-to-b from-brand/0 to-brand/0 transition-all group-hover:from-brand/20" />
      <div className="relative flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {listing.category}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
              {source === 'pay-skills' ? 'pay.sh' : 'Leash'}
            </Badge>
          </div>
          <Badge variant={isFree ? 'free' : 'paid'}>
            {isFree
              ? 'Free'
              : `${listing.pricing.amount ?? '?'} ${listing.pricing.currency ?? 'USDC'}/call`}
          </Badge>
        </div>
        <div className="font-semibold leading-tight group-hover:text-brand-strong">
          {listing.name}
        </div>
        <p className="line-clamp-2 text-xs text-fg-muted">{listing.description}</p>
        <div className="flex items-center gap-2 pt-1 text-[11px] text-fg-subtle">
          <span>
            {capabilityCount} capabilit{capabilityCount === 1 ? 'y' : 'ies'}
          </span>
          {listing.rating && listing.rating.count > 0 ? (
            <>
              <span>·</span>
              <span>
                {listing.rating.avg.toFixed(1)}★ ({listing.rating.count})
              </span>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

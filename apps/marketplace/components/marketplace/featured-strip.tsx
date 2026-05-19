'use client';

import Link from 'next/link';
import useSWR from 'swr';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type Listing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  pricing: { type: string; amount?: string; currency?: string };
  tools: Array<{ name: string }>;
  rating?: { avg: number; count: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ items: Listing[] }>);

/**
 * Featured capabilities strip on the public landing. Pulls top approved
 * listings from the BFF and renders them as compact gradient cards.
 */
export function FeaturedStrip() {
  const { data, isLoading } = useSWR<{ items: Listing[] }>(
    '/api/listings?status=approved&limit=6',
    fetcher,
  );

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
      ) : !data || data.items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-fg-muted">
          No capabilities yet. Be the first to{' '}
          <Link href="/creator/list" className="text-brand hover:underline">
            list one
          </Link>
          .
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.items.slice(0, 6).map((l) => (
            <FeaturedCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeaturedCard({ listing }: { listing: Listing }) {
  const isFree = listing.pricing.type === 'free';
  return (
    <Link
      href={`/listing/${listing.slug}`}
      className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong"
    >
      <div className="absolute inset-x-0 -top-32 h-32 bg-gradient-to-b from-brand/0 to-brand/0 transition-all group-hover:from-brand/20" />
      <div className="relative flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {listing.category}
          </Badge>
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
            {listing.tools.length} capabilit{listing.tools.length === 1 ? 'y' : 'ies'}
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

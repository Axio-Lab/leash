'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import useSWR from 'swr';

import { ListingCard, type Listing } from '@/components/listing-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ items: DiscoverItem[] }>;
};

const SORTS = [
  { id: 'relevant', label: 'Relevant' },
  { id: 'rating', label: 'Trusted' },
  { id: 'price', label: 'Lowest price' },
] as const;
type Sort = (typeof SORTS)[number]['id'];

const CATEGORIES = ['all', 'search', 'data', 'payments', 'compute', 'social', 'misc'] as const;
const SOURCES = ['all', 'leash', 'pay-skills'] as const;

type Source = (typeof SOURCES)[number];

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
  health_status: 'ok' | 'warn' | 'down' | null;
  endpoint_count?: number;
  tools: Array<{ name: string }>;
};

function normalizeListing(item: DiscoverItem): Listing {
  return {
    id: `${item.source}:${item.slug}`,
    source: item.source,
    slug: item.slug,
    name: item.title,
    description: item.description,
    category: item.category || 'misc',
    endpoint: item.url,
    pricing: {
      type: item.pricing_type,
      ...(item.price_usdc ? { amount: item.price_usdc, currency: 'USDC' } : {}),
    },
    tools: item.tools ?? [],
    ...(typeof item.endpoint_count === 'number' ? { endpoint_count: item.endpoint_count } : {}),
    health_status: item.health_status,
    status: 'approved',
    ...(typeof item.rating === 'number' ? { rating: { avg: item.rating * 5, count: 1 } } : {}),
  };
}

function priceSortValue(listing: Listing): number {
  if (listing.pricing.type === 'free') return 0;
  if (listing.pricing.type === 'per_call') {
    const n = Number(listing.pricing.amount ?? Number.POSITIVE_INFINITY);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

export default function BrowsePage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [source, setSource] = useState<Source>('all');
  const [sort, setSort] = useState<Sort>('relevant');
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set('q', q.trim());
  if (source !== 'all') params.set('source', source);
  params.set('limit', '75');
  const { data, error, isLoading } = useSWR<{ items: DiscoverItem[] }>(
    `/api/discover?${params.toString()}`,
    fetcher,
  );

  const items = useMemo(() => {
    return (data?.items ?? [])
      .map(normalizeListing)
      .filter((item) => category === 'all' || item.category === category)
      .slice()
      .sort((a, b) => {
        if (sort === 'price') return priceSortValue(a) - priceSortValue(b);
        if (sort === 'rating') return (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0);
        return 0;
      });
  }, [category, data?.items, sort]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <Badge variant="outline" className="font-mono uppercase tracking-widest">
              Capability registry
            </Badge>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Explore agent capabilities
            </h1>
            <p className="text-fg-muted text-sm">
              Leash listings and pay.sh APIs your agent identity can discover, pin, and call.
            </p>
          </div>
          <Button asChild variant="outline" className="hidden md:inline-flex">
            <Link href="/creator/list">List your capability →</Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search capabilities (e.g. search, airtime, RPC)"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {SORTS.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={sort === s.id ? 'secondary' : 'ghost'}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors',
              category === c
                ? 'border-brand bg-brand/15 text-brand-strong'
                : 'border-border text-fg-muted hover:border-border-strong',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {SOURCES.map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors',
              source === s
                ? 'border-brand bg-brand/15 text-brand-strong'
                : 'border-border text-fg-muted hover:border-border-strong',
            )}
          >
            {s === 'all' ? 'all sources' : s === 'pay-skills' ? 'pay.sh' : 'Leash'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </ul>
      ) : error ? (
        <div className="text-danger text-sm">{(error as Error).message}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-bg-elev/40 p-14 text-center text-sm text-fg-muted">
          No capabilities match this filter.{' '}
          <Link href="/creator/list" className="text-brand hover:underline">
            List a capability →
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

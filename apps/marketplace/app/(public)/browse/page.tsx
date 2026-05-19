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
  return r.json() as Promise<{ items: Listing[] }>;
};

const SORTS = [
  { id: 'popular', label: 'Most used' },
  { id: 'newest', label: 'Newest' },
  { id: 'rating', label: 'Top rated' },
] as const;
type Sort = (typeof SORTS)[number]['id'];

const CATEGORIES = ['all', 'search', 'data', 'payments', 'compute', 'social', 'misc'] as const;

export default function BrowsePage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [sort, setSort] = useState<Sort>('popular');
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set('q', q.trim());
  if (category !== 'all') params.set('category', category);
  const { data, error, isLoading } = useSWR<{ items: Listing[] }>(
    `/api/listings?${params.toString()}`,
    fetcher,
  );

  const items = useMemo(() => {
    return (data?.items ?? []).slice().sort((a, b) => {
      if (sort === 'newest') return b.created_at.localeCompare(a.created_at);
      if (sort === 'rating') return (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0);
      return (b.rating?.count ?? 0) - (a.rating?.count ?? 0);
    });
  }, [data?.items, sort]);

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
              MCP servers, paid APIs, and autonomous services tied to agent identities.
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
          No listings match this filter.{' '}
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

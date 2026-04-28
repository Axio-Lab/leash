'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { ListingCard, type Listing } from '@/components/listing-card';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ items: Listing[] }>;
};

const SORTS = ['popular', 'newest', 'rating'] as const;
type Sort = (typeof SORTS)[number];

export default function BrowsePage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<Sort>('popular');
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set('q', q.trim());
  if (category.trim().length > 0) params.set('category', category.trim());
  const { data, error, isLoading } = useSWR<{ items: Listing[] }>(
    `/api/listings?${params.toString()}`,
    fetcher,
  );

  const items = (data?.items ?? []).slice().sort((a, b) => {
    if (sort === 'newest') return b.created_at.localeCompare(a.created_at);
    if (sort === 'rating') return (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0);
    return (b.rating?.count ?? 0) - (a.rating?.count ?? 0);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tools (e.g. search, airtime, RPC)"
          className="flex-1 min-w-[260px] rounded-md border bg-bg-elev px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          className="w-40 rounded-md border bg-bg-elev px-3 py-2 text-sm"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="rounded-md border bg-bg-elev px-3 py-2 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              Sort: {s}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <div className="text-fg-muted text-sm">Loading…</div>
      ) : error ? (
        <div className="text-danger text-sm">{(error as Error).message}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-fg-muted text-sm">
          No listings match.{' '}
          <Link href="/dev" className="text-brand">
            List one →
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

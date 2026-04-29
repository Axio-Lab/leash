'use client';

import * as React from 'react';
import useSWR from 'swr';

import { loadFavorites, saveFavorites, type FavoriteEntry } from '@/lib/favorites';

import { usePrivy } from '@privy-io/react-auth';

const searchFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { items: [] };
  return res.json() as Promise<{ items?: unknown[] }>;
};

export default function FavoritesSettingsPage() {
  const { user } = usePrivy();
  const pid = user?.id ?? '';
  const [q, setQ] = React.useState('');
  const { data } = useSWR(
    q.length >= 2 ? `/api/marketplace-search?q=${encodeURIComponent(q)}` : null,
    searchFetcher,
  );
  const [local, setLocal] = React.useState<FavoriteEntry[]>([]);

  React.useEffect(() => {
    if (!pid) return;
    setLocal(loadFavorites(pid));
  }, [pid]);

  function toggleFavorite(entry: FavoriteEntry) {
    if (!pid) return;
    const next = local.some((x) => x.slug === entry.slug && x.listingId === entry.listingId)
      ? local.filter((x) => !(x.slug === entry.slug && x.listingId === entry.listingId))
      : [...local, entry];
    setLocal(next);
    saveFavorites(pid, next);
  }

  const rawItems = data?.items ?? [];
  const listings = rawItems
    .map((row) => {
      const r = row as Record<string, unknown>;
      const slug = typeof r.slug === 'string' ? r.slug : '';
      const title = typeof r.title === 'string' ? r.title : slug;
      const listingId = typeof r.id === 'string' ? r.id : slug;
      const kind = typeof r.kind === 'string' && r.kind === 'agent' ? 'agent' : 'tool';
      const price =
        typeof r.price_per_call_usdc === 'string'
          ? r.price_per_call_usdc
          : typeof r.pricePerCallUsdc === 'string'
            ? r.pricePerCallUsdc
            : undefined;
      if (!slug) return null;
      return { slug, title, listingId, kind: kind as 'tool' | 'agent', pricePerCallUsdc: price };
    })
    .filter(Boolean) as FavoriteEntry[];

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-muted">
        Pin registry listings — your agent can invoke them via{' '}
        <code className="font-mono text-xs">leash_call_marketplace_tool</code> once wired to
        seller/buyer kits.
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search marketplace…"
        className="w-full max-w-md rounded-lg border border-border bg-bg px-3 py-2 text-sm"
      />
      <div className="space-y-2">
        {listings.map((l) => {
          const active = local.some((x) => x.slug === l.slug && x.listingId === l.listingId);
          return (
            <div
              key={`${l.slug}-${l.listingId}`}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <div>
                <div className="font-medium">{l.title}</div>
                <div className="text-xs text-fg-muted font-mono">{l.slug}</div>
              </div>
              <button
                type="button"
                className={`text-sm px-3 py-1.5 rounded-lg ${active ? 'bg-brand/20 text-brand' : 'bg-bg-elev hover:bg-brand/10'}`}
                onClick={() => toggleFavorite({ ...l })}
              >
                {active ? 'Pinned' : 'Pin'}
              </button>
            </div>
          );
        })}
      </div>
      <div>
        <div className="text-sm font-medium mb-2">Pinned ({local.length})</div>
        <ul className="text-sm text-fg-muted space-y-1">
          {local.map((l) => (
            <li key={`${l.slug}-${l.listingId}`}>
              {l.title}{' '}
              <button
                type="button"
                className="text-danger ml-2 hover:underline"
                onClick={() => toggleFavorite(l)}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

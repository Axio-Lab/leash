'use client';

import { z } from 'zod';

const EntrySchema = z.object({
  slug: z.string(),
  kind: z.enum(['tool', 'agent']),
  listingId: z.string(),
  title: z.string(),
  pricePerCallUsdc: z.string().optional(),
});

export type FavoriteEntry = z.infer<typeof EntrySchema>;

function key(privyId: string): string {
  return `leash:favorites:${privyId}`;
}

export function loadFavorites(privyId: string): FavoriteEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key(privyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const arr = z.array(EntrySchema).safeParse(parsed);
    return arr.success ? arr.data : [];
  } catch {
    return [];
  }
}

export function saveFavorites(privyId: string, items: FavoriteEntry[]): void {
  localStorage.setItem(key(privyId), JSON.stringify(items));
}

/** Compact JSON for optional `x-leash-favorites` header on chat requests. */
export function favoritesJsonForHeader(privyId: string): string | null {
  const items = loadFavorites(privyId);
  if (items.length === 0) return null;
  const json = JSON.stringify(items.slice(0, 40));
  return json.length > 4096 ? null : json;
}

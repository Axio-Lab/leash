'use client';

import { z } from 'zod';

const PayProtocolSchema = z.enum(['x402', 'mpp']);

const EntrySchema = z.object({
  slug: z.string(),
  kind: z.enum(['tool', 'agent']),
  listingId: z.string(),
  title: z.string(),
  pricePerCallUsdc: z.string().optional(),
  /**
   * Catalogue the entry came from. Optional for backwards compat
   * with favorites stored before pay-skills support landed; falls
   * back to `'leash'` on read.
   */
  source: z.enum(['leash', 'pay-skills']).optional(),
  /** Endpoint URL from the discover row, when known. */
  url: z.string().optional(),
  /**
   * Payment rail(s) advertised for this listing. Optional for older
   * pinned rows; UI defaults to x402-only.
   */
  protocols: z.array(PayProtocolSchema).optional(),
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

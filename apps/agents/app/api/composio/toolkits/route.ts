import { NextResponse, type NextRequest } from 'next/server';

import { getComposio } from '@/lib/composio';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

type ToolkitItem = {
  slug: string;
  name: string;
  logo: string | null;
  description: string;
  tools_count: number | null;
  categories: Array<{ slug: string; name: string }>;
  auth_schemes: string[];
  no_auth: boolean;
};

type CacheEntry = { items: ToolkitItem[]; expiresAt: number };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const PAGE_LIMIT = 200;
const MAX_PAGES = 20;

/**
 * Lists ALL Composio-managed toolkits (1000+) by paginating through every
 * page via the underlying @composio/client. Cached in-memory for 5 min.
 */
export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const composio = getComposio();
  if (!composio) {
    return NextResponse.json({
      items: [],
      warning: 'COMPOSIO_API_KEY is not configured — connections are disabled.',
    });
  }

  const sp = req.nextUrl.searchParams;
  const category = sp.get('category') ?? undefined;
  const q = (sp.get('q') ?? '').toLowerCase().trim();

  const cacheKey = category ?? '__all__';
  const cached = CACHE.get(cacheKey);

  let all: ToolkitItem[];
  if (cached && cached.expiresAt > Date.now()) {
    all = cached.items;
  } else {
    try {
      const client = (
        composio as unknown as {
          client: {
            toolkits: {
              list: (q: {
                managed_by?: 'all' | 'composio' | 'project';
                sort_by?: 'usage' | 'alphabetically';
                category?: string;
                cursor?: string;
                limit?: number;
              }) => Promise<{
                items: Array<{
                  slug: string;
                  name: string;
                  meta?: {
                    logo?: string;
                    description?: string;
                    categories?: Array<{ id?: string; name?: string }>;
                    tools_count?: number;
                  };
                  auth_schemes?: string[];
                  no_auth?: boolean;
                }>;
                next_cursor?: string | null;
              }>;
            };
          };
        }
      ).client;

      const collected: ToolkitItem[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await client.toolkits.list({
          managed_by: 'composio',
          sort_by: 'usage',
          limit: PAGE_LIMIT,
          ...(cursor ? { cursor } : {}),
          ...(category ? { category } : {}),
        });

        for (const t of page.items ?? []) {
          collected.push({
            slug: t.slug,
            name: t.name,
            logo: t.meta?.logo ?? null,
            description: t.meta?.description ?? '',
            tools_count: t.meta?.tools_count ?? null,
            categories: (t.meta?.categories ?? []).map((c) => ({
              slug: c.id ?? '',
              name: c.name ?? '',
            })),
            auth_schemes: t.auth_schemes ?? [],
            no_auth: Boolean(t.no_auth),
          });
        }

        if (!page.next_cursor) break;
        cursor = page.next_cursor;
      }

      all = collected;
      CACHE.set(cacheKey, { items: all, expiresAt: Date.now() + CACHE_TTL_MS });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'composio_error';
      return NextResponse.json({ error: message, items: [] }, { status: 502 });
    }
  }

  const items = q
    ? all.filter(
        (t) =>
          t.slug.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      )
    : all;

  return NextResponse.json({ items, total: items.length, all_total: all.length });
}

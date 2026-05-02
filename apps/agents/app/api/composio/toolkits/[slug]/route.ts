import { NextResponse, type NextRequest } from 'next/server';

import { getComposio } from '@/lib/composio';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

type ToolBrief = {
  slug: string;
  name: string;
  description: string;
  no_auth: boolean;
};

type CacheEntry = {
  toolkit: {
    slug: string;
    name: string;
    logo: string | null;
    description: string;
    tools_count: number | null;
    categories: Array<{ slug: string; name: string }>;
  } | null;
  tools: ToolBrief[];
  expiresAt: number;
};
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

const TOOLS_PAGE_LIMIT = 200;
const MAX_PAGES = 5;

/**
 * Returns toolkit metadata + a list of tools provided by that toolkit.
 * Used by the connections modal to show "what's inside" before connecting.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });

  const composio = getComposio();
  if (!composio) {
    return NextResponse.json({ error: 'composio_unconfigured' }, { status: 503 });
  }

  const cached = CACHE.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ toolkit: cached.toolkit, tools: cached.tools });
  }

  try {
    const client = (
      composio as unknown as {
        client: {
          toolkits: {
            retrieve: (slug: string) => Promise<{
              slug: string;
              name: string;
              meta?: {
                logo?: string;
                description?: string;
                tools_count?: number;
                categories?: Array<{ id?: string; name?: string }>;
              };
            }>;
          };
          tools: {
            list: (q: { toolkit_slug?: string; cursor?: string; limit?: number }) => Promise<{
              items: Array<{
                slug: string;
                name: string;
                description?: string;
                no_auth?: boolean;
              }>;
              next_cursor?: string | null;
            }>;
          };
        };
      }
    ).client;

    let toolkitMeta: CacheEntry['toolkit'] = null;
    try {
      const r = await client.toolkits.retrieve(slug);
      toolkitMeta = {
        slug: r.slug,
        name: r.name,
        logo: r.meta?.logo ?? null,
        description: r.meta?.description ?? '',
        tools_count: r.meta?.tools_count ?? null,
        categories: (r.meta?.categories ?? []).map((c) => ({
          slug: c.id ?? '',
          name: c.name ?? '',
        })),
      };
    } catch {
      // metadata is best-effort
    }

    const tools: ToolBrief[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await client.tools.list({
        toolkit_slug: slug,
        limit: TOOLS_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      for (const t of page.items ?? []) {
        tools.push({
          slug: t.slug,
          name: t.name,
          description: t.description ?? '',
          no_auth: Boolean(t.no_auth),
        });
      }
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }

    CACHE.set(slug, { toolkit: toolkitMeta, tools, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json({ toolkit: toolkitMeta, tools });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'composio_error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

'use client';

import Link from 'next/link';
import { use } from 'react';
import useSWR from 'swr';

import { StarRating } from '@/components/ratings';
import { ReviewBlock } from '@/components/review-form';
import { ToolsTable, type Tool } from '@/components/tools-table';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

type Listing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricing: { type: string; amount?: string; currency?: string };
  tools: Tool[];
  docs_url: string | null;
  free_tier: number;
  health_status: 'ok' | 'warn' | 'down' | null;
  status: string;
};

const json = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export default function ListingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, error, isLoading } = useSWR<{
    listing: Listing;
    rating: { avg: number; count: number };
  }>(`/api/listings/by-slug/${slug}`, json);

  return (
    <div className="space-y-6">
      <Link href="/browse" className="text-sm text-fg-muted hover:text-fg">
        ← Back to browse
      </Link>
      {isLoading ? (
        <div className="text-fg-muted">Loading…</div>
      ) : error ? (
        <div className="text-danger">{(error as Error).message}</div>
      ) : !data ? null : (
        <article className="space-y-8">
          <header className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-fg-subtle">
              {data.listing.category}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{data.listing.name}</h1>
            <p className="text-fg-muted max-w-3xl">{data.listing.description}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm pt-1">
              <StarRating value={data.rating.avg} count={data.rating.count} />
              <span className="text-fg-subtle">·</span>
              <span className="text-fg-muted">
                {data.listing.pricing.type === 'free'
                  ? 'Free'
                  : `${data.listing.pricing.amount ?? '?'} ${data.listing.pricing.currency ?? 'USDC'} / call`}
              </span>
              {data.listing.free_tier > 0 ? (
                <>
                  <span className="text-fg-subtle">·</span>
                  <span className="text-fg-muted">
                    Free tier: {data.listing.free_tier} calls / day
                  </span>
                </>
              ) : null}
            </div>
            <div className="flex gap-2 pt-3">
              <Link
                href={`${NEXT_PUBLIC_AGENTS_URL}/agents/new?add=${encodeURIComponent(data.listing.slug)}`}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
              >
                Add to agent
              </Link>
              {data.listing.docs_url ? (
                <a
                  href={data.listing.docs_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border px-4 py-2 text-sm hover:border-border-strong"
                >
                  Docs ↗
                </a>
              ) : null}
            </div>
          </header>

          <section className="rounded-lg border bg-bg-elev p-5 space-y-3">
            <h2 className="text-sm font-medium">Tools</h2>
            <ToolsTable tools={data.listing.tools} />
          </section>

          <section className="rounded-lg border bg-bg-elev p-5 space-y-2">
            <h2 className="text-sm font-medium">Endpoint</h2>
            <code className="font-mono text-xs text-fg-muted block break-all">
              {data.listing.endpoint}
            </code>
          </section>

          <ReviewBlock listingId={data.listing.id} />
        </article>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { use } from 'react';
import useSWR from 'swr';

import { StarRating } from '@/components/ratings';

type Detail = {
  listing: {
    id: string;
    slug: string;
    name: string;
    description: string;
    status: string;
    category: string;
    endpoint: string;
    pricing: { type: string; amount?: string; currency?: string };
    tools: Array<{ name: string }>;
    health_status: 'ok' | 'warn' | 'down' | null;
    created_at: string;
  };
  rating: { avg: number; count: number };
};

const json = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export default function ManageListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, error, isLoading } = useSWR<Detail>(`/api/listings/${slug}`, json);
  return (
    <div className="space-y-6">
      <Link href="/dev/listings" className="text-sm text-fg-muted hover:text-fg">
        ← My listings
      </Link>
      {isLoading ? (
        <div className="text-fg-muted">Loading…</div>
      ) : error ? (
        <div className="text-danger">{(error as Error).message}</div>
      ) : !data ? null : (
        <div className="space-y-5">
          <header className="space-y-1">
            <div className="text-xs uppercase tracking-widest text-fg-subtle">
              {data.listing.category}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{data.listing.name}</h1>
            <div className="text-fg-muted text-sm">{data.listing.description}</div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Stat label="Status" value={data.listing.status} />
            <Stat label="Pricing">
              {data.listing.pricing.type === 'free'
                ? 'Free'
                : `${data.listing.pricing.amount ?? '?'} ${data.listing.pricing.currency ?? 'USDC'} / call`}
            </Stat>
            <Stat label="Health" value={data.listing.health_status ?? '—'} />
          </div>

          <div className="rounded-lg border bg-bg-elev p-5 space-y-2">
            <div className="text-xs text-fg-muted">Endpoint</div>
            <code className="block break-all font-mono text-xs">{data.listing.endpoint}</code>
          </div>

          <div className="rounded-lg border bg-bg-elev p-5">
            <div className="text-xs text-fg-muted mb-2">Rating</div>
            <StarRating value={data.rating.avg} count={data.rating.count} size="lg" />
          </div>

          <div className="rounded-lg border border-dashed p-5 text-fg-muted text-xs text-center">
            Revenue charts and per-receipt drill-down ship with Phase 3 polish.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-bg-elev p-4">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1 text-sm">{value ?? children}</div>
    </div>
  );
}

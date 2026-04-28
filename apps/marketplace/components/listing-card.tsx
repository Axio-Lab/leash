'use client';

import Link from 'next/link';

import { cn } from '@/lib/cn';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

export type Listing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricing: { type: string; amount?: string; currency?: string };
  tools: Array<{ name: string }>;
  health_status: 'ok' | 'warn' | 'down' | null;
  status: string;
  created_at: string;
  rating?: { avg: number; count: number };
};

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <li className="rounded-lg border bg-bg-elev p-4 space-y-2 hover:border-border-strong transition-colors">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/listing/${listing.slug}`} className="font-medium hover:text-brand">
          {listing.name}
        </Link>
        <Pricing pricing={listing.pricing} />
      </div>
      <div className="text-xs text-fg-muted flex items-center gap-2">
        <span>{listing.category}</span>
        <span>·</span>
        <Health status={listing.health_status} />
        {listing.rating && listing.rating.count > 0 ? (
          <>
            <span>·</span>
            <span>
              {listing.rating.avg.toFixed(1)} ★ ({listing.rating.count})
            </span>
          </>
        ) : null}
      </div>
      <p className="text-sm text-fg-muted line-clamp-2">{listing.description}</p>
      <div className="text-xs text-fg-subtle">
        {listing.tools.length} tool{listing.tools.length === 1 ? '' : 's'}
      </div>
      <div className="pt-2">
        <Link
          href={`${NEXT_PUBLIC_AGENTS_URL}/agents/new?add=${encodeURIComponent(listing.slug)}`}
          className="inline-flex text-xs rounded-md bg-brand px-2.5 py-1.5 text-white hover:bg-brand-strong"
        >
          Add to agent
        </Link>
      </div>
    </li>
  );
}

function Pricing({ pricing }: { pricing: Listing['pricing'] }) {
  if (pricing.type === 'free') {
    return (
      <span className="rounded-full bg-emerald-950/40 text-emerald-300 px-2 py-0.5 text-xs">
        Free
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-950/40 text-amber-300 px-2 py-0.5 text-xs whitespace-nowrap">
      {pricing.amount ?? 'paid'} {pricing.currency ?? 'USDC'}/call
    </span>
  );
}

function Health({ status }: { status: Listing['health_status'] }) {
  if (status == null) return <span className="text-fg-subtle">health: unknown</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        status === 'ok'
          ? 'text-emerald-300'
          : status === 'warn'
            ? 'text-amber-300'
            : 'text-rose-300',
      )}
    >
      <span className="size-1.5 rounded-full bg-current" /> {status}
    </span>
  );
}

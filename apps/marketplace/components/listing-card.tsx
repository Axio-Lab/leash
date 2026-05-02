'use client';

import Link from 'next/link';
import { Cpu, Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    <li className="group relative flex flex-col rounded-xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-border-strong">
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <Link href={`/listing/${listing.slug}`} className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {listing.category}
          </Badge>
          <Pricing pricing={listing.pricing} />
        </div>
        <div>
          <div className="font-semibold leading-tight group-hover:text-brand-strong">
            {listing.name}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{listing.description}</p>
        </div>
        <div className="mt-auto flex items-center gap-3 text-[11px] text-fg-subtle">
          <span className="inline-flex items-center gap-1">
            <Cpu className="size-3" />
            {listing.tools.length} tool{listing.tools.length === 1 ? '' : 's'}
          </span>
          {listing.rating && listing.rating.count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Star className="size-3 fill-current text-amber-300" />
              {listing.rating.avg.toFixed(1)} ({listing.rating.count})
            </span>
          ) : null}
          <Health status={listing.health_status} />
        </div>
      </Link>
      <div className="flex items-center justify-between border-t border-border p-3">
        <Link href={`/listing/${listing.slug}`} className="text-xs text-fg-muted hover:text-fg">
          Details
        </Link>
        <Button asChild size="sm">
          <Link
            href={`${NEXT_PUBLIC_AGENTS_URL}/agents/new?add=${encodeURIComponent(listing.slug)}`}
          >
            Add to agent
          </Link>
        </Button>
      </div>
    </li>
  );
}

function Pricing({ pricing }: { pricing: Listing['pricing'] }) {
  if (pricing.type === 'free') {
    return <Badge variant="free">Free</Badge>;
  }
  return (
    <Badge variant="paid" className="whitespace-nowrap">
      {pricing.amount ?? 'paid'} {pricing.currency ?? 'USDC'}/call
    </Badge>
  );
}

function Health({ status }: { status: Listing['health_status'] }) {
  if (status == null) return null;
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

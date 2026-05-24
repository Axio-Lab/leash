'use client';

import Link from 'next/link';
import { ArrowRight, Cpu, ShieldCheck, ShieldQuestion, Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';
import { useCapabilityCount } from '@/lib/use-pay-skills-capability-count';

export type Listing = {
  id: string;
  source?: 'leash' | 'pay-skills';
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricing: { type: string; amount?: string; currency?: string };
  endpoints?: Array<{ method: string; url: string; description: string }>;
  tools?: Array<{ name: string }>;
  endpoint_count?: number;
  seller_agent_mint?: string | null;
  seller_identity?: {
    mint: string;
    handle: string | null;
    name: string;
    reputation: { rating: number; settled_calls: number };
  } | null;
  health_status: 'ok' | 'warn' | 'down' | null;
  status: string;
  created_at?: string;
  rating?: { avg: number; count: number };
};

export function ListingCard({ listing }: { listing: Listing }) {
  const source = listing.source ?? 'leash';
  const detailHref =
    source === 'pay-skills' ? `/capability/pay-skills/${listing.slug}` : `/listing/${listing.slug}`;
  const addHref = `${NEXT_PUBLIC_AGENTS_URL}/settings/favorites?${new URLSearchParams({
    source,
    q: listing.name || listing.slug,
  }).toString()}`;
  const { count } = useCapabilityCount(listing);

  return (
    <li className="capability-card-glide group relative flex min-h-[230px] flex-col overflow-hidden rounded-xl border border-border bg-card p-4 outline-none transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out hover:-translate-y-1 hover:border-brand/50 hover:shadow-[0_18px_70px_-42px_oklch(0.66_0.19_268/0.75)]">
      <Link
        href={detailHref}
        className="relative z-10 flex flex-1 flex-col justify-between gap-5 rounded-lg focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="grid size-9 place-items-center rounded-lg border border-border bg-bg/70 transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:border-brand/50 group-hover:bg-brand/10">
              <Cpu className="size-4 text-brand-strong" aria-hidden="true" />
            </div>
            <span className="rounded-md border border-border bg-bg/70 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-fg-muted backdrop-blur-sm">
              {source === 'pay-skills' ? 'pay.sh' : 'leash'}
            </span>
          </div>

          <div className="space-y-2">
            <h3 className="text-[15px] font-medium tracking-tight text-fg group-hover:text-brand-strong">
              {listing.name}
            </h3>
            <p className="line-clamp-3 text-sm leading-snug text-fg-muted">{listing.description}</p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
            <span className="rounded-md border border-border bg-bg/70 px-2 py-1 font-mono">
              #{listing.category}
            </span>
            <span className="rounded-md border border-border bg-bg/70 px-2 py-1 font-mono">
              #{count} capabilit{count === 1 ? 'y' : 'ies'}
            </span>
            <Pricing pricing={listing.pricing} />
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-fg-subtle">
            {listing.rating && listing.rating.count > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3 fill-current text-amber-300" />
                {listing.rating.avg.toFixed(1)} ({listing.rating.count})
              </span>
            ) : null}
            <IdentityStatus source={source} identity={listing.seller_identity ?? null} />
            <Health status={listing.health_status} />
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-brand-strong">
            View <ArrowRight className="size-3" aria-hidden="true" />
          </span>
        </div>
      </Link>
      <div className="relative z-10 mt-4 flex items-center justify-end border-t border-border pt-3">
        <Button asChild size="sm">
          <Link href={addHref}>Add capability</Link>
        </Button>
      </div>
    </li>
  );
}

function IdentityStatus({
  source,
  identity,
}: {
  source: 'leash' | 'pay-skills';
  identity: Listing['seller_identity'] | null;
}) {
  if (source === 'pay-skills') {
    return (
      <span className="inline-flex items-center gap-1">
        <ShieldQuestion className="size-3" />
        external
      </span>
    );
  }
  if (!identity) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-300">
        <ShieldQuestion className="size-3" />
        unverified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-emerald-300">
      <ShieldCheck className="size-3" />
      {identity.handle ? `@${identity.handle}` : 'identity'}
    </span>
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

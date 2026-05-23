'use client';

import Link from 'next/link';
import { ExternalLink, PackagePlus, Sparkles } from 'lucide-react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ items: Listing[] }>;
};

type Listing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'disabled';
  category: string;
  pricing: { type: string; amount?: string; currency?: string };
  tools: Array<{ name: string }>;
  health_status: 'ok' | 'warn' | 'down' | null;
  created_at: string;
};

export default function MyToolsPage() {
  const { user } = usePrivy();
  const privyId = (user as { id?: string } | null)?.id ?? '';
  const { data, error, isLoading } = useSWR<{ items: Listing[] }>(
    privyId
      ? `/api/listings?owner_privy_id=${encodeURIComponent(privyId)}&status=pending,approved,rejected,disabled`
      : null,
    fetcher,
  );

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge
            variant="outline"
            className="border-brand/40 font-mono uppercase tracking-widest text-brand-strong"
          >
            Your registry
          </Badge>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">My capabilities</h1>
          <p className="text-fg-muted text-sm mt-1">
            Capabilities you've listed on leash.market. Approval is manual today; expect ~24h.
          </p>
        </div>
        <Button asChild>
          <Link href="/creator/list">
            <PackagePlus className="size-4" /> List capability
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : error ? (
        <div className="text-danger text-sm">{(error as Error).message}</div>
      ) : items.length === 0 ? (
        <Card className="bg-aurora text-center p-12">
          <Sparkles className="size-6 mx-auto text-brand-strong" />
          <h3 className="mt-3 font-semibold">No capabilities yet</h3>
          <p className="text-sm text-fg-muted mt-1 max-w-md mx-auto">
            Drop a manifest URL or hand-build a listing. Approved capabilities surface on the public
            registry instantly.
          </p>
          <Button asChild className="mt-4">
            <Link href="/creator/list">List your first capability</Link>
          </Button>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((l) => (
            <li key={l.id}>
              <ToolRow listing={l} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolRow({ listing }: { listing: Listing }) {
  const isFree = listing.pricing.type === 'free';
  return (
    <Card className="capability-card-glide relative overflow-hidden p-0">
      <div className="relative z-10">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <div className="flex-1">
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {listing.category}
            </Badge>
            <CardTitle className="mt-2">{listing.name}</CardTitle>
            <CardDescription className="font-mono text-[11px] mt-1">{listing.slug}</CardDescription>
          </div>
          <StatusPill status={listing.status} />
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Badge variant={isFree ? 'free' : 'paid'}>
              {isFree
                ? 'Free'
                : `${listing.pricing.amount ?? '?'} ${listing.pricing.currency ?? 'USDC'}/call`}
            </Badge>
            <span>
              · {listing.tools.length} callable tool{listing.tools.length === 1 ? '' : 's'}
            </span>
            {listing.health_status ? <span>· {listing.health_status}</span> : null}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link
              href={`/listing/${listing.slug}`}
              className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
            >
              Public <ExternalLink className="size-3" />
            </Link>
            <Link
              href={`/creator/tools/${listing.slug}`}
              className="text-brand-strong hover:underline"
            >
              Manage →
            </Link>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function StatusPill({ status }: { status: Listing['status'] }) {
  const variant: Record<Listing['status'], 'success' | 'warning' | 'danger' | 'secondary'> = {
    approved: 'success',
    pending: 'warning',
    rejected: 'danger',
    disabled: 'secondary',
  };
  return <Badge variant={variant[status]}>{status}</Badge>;
}

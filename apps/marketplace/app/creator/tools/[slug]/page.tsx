'use client';

import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import useSWR from 'swr';

import { StarRating } from '@/components/ratings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type Detail = {
  listing: {
    id: string;
    slug: string;
    name: string;
    description: string;
    status: 'pending' | 'approved' | 'rejected' | 'disabled';
    category: string;
    endpoint: string;
    pricing: { type: string; amount?: string; currency?: string };
    tools: Array<{ name: string; description: string }>;
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
  const { data, error, isLoading } = useSWR<Detail>(`/api/listings/by-slug/${slug}`, json);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (error) return <div className="text-danger">{(error as Error).message}</div>;
  if (!data) return null;

  const isFree = data.listing.pricing.type === 'free';

  return (
    <div className="space-y-6">
      <Link
        href="/creator/tools"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> My capabilities
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-aurora p-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-brand/40 font-mono uppercase text-brand-strong"
            >
              {data.listing.category}
            </Badge>
            <Badge
              variant={
                data.listing.status === 'approved'
                  ? 'success'
                  : data.listing.status === 'pending'
                    ? 'warning'
                    : data.listing.status === 'rejected'
                      ? 'danger'
                      : 'secondary'
              }
            >
              {data.listing.status}
            </Badge>
            <Badge variant={isFree ? 'free' : 'paid'}>
              {isFree
                ? 'Free'
                : `${data.listing.pricing.amount ?? '?'} ${data.listing.pricing.currency ?? 'USDC'}/call`}
            </Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{data.listing.name}</h1>
          <p className="max-w-2xl text-fg-muted">{data.listing.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/listing/${data.listing.slug}`}>
              View public <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Rating">
          <StarRating value={data.rating.avg} count={data.rating.count} />
        </Stat>
        <Stat label="Health">{data.listing.health_status ?? '—'}</Stat>
        <Stat label="Callable tools">{data.listing.tools.length}</Stat>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Endpoint</CardTitle>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded-md border bg-bg p-3 font-mono text-xs text-fg-muted">
            {data.listing.endpoint}
          </code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Callable tools</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {data.listing.tools.map((t) => (
              <li key={t.name} className="flex items-start gap-3 py-3 text-sm">
                <code className="min-w-[10ch] font-mono text-brand-strong">{t.name}</code>
                <span className="text-fg-muted">{t.description}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="rounded-md border border-dashed p-6 text-center text-xs text-fg-muted">
        Per-call receipts and revenue ship in the next batch. For now, agents settle directly to
        your wallet — track with{' '}
        <a
          href={process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://explorer.leash.market'}
          target="_blank"
          rel="noreferrer"
          className="text-brand-strong hover:underline"
        >
          explorer.leash.market
        </a>
        .
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-widest text-fg-subtle">{label}</div>
      <div className="mt-2 text-sm">{children}</div>
    </Card>
  );
}

'use client';

import Link from 'next/link';
import * as React from 'react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ items: Listing[] }>;
};

type Listing = {
  id: string;
  slug: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'disabled';
  category: string;
  pricing: { type: string; amount?: string; currency?: string };
  health_status: 'ok' | 'warn' | 'down' | null;
  created_at: string;
};

export default function MyListingsPage() {
  const { user } = usePrivy();
  const privyId = (user as { id?: string } | null)?.id ?? '';
  const { data, error, isLoading } = useSWR<{ items: Listing[] }>(
    privyId
      ? `/api/listings?owner_privy_id=${encodeURIComponent(privyId)}&status=pending,approved,rejected,disabled`
      : null,
    fetcher,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My listings</h1>
          <p className="text-fg-muted text-sm mt-1">
            Listings you've submitted. Approval is manual today; expect ~24h.
          </p>
        </div>
        <Link
          href="/dev/list"
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
        >
          + List a tool
        </Link>
      </div>
      {isLoading ? (
        <div className="text-fg-muted text-sm">Loading…</div>
      ) : error ? (
        <div className="text-danger text-sm">{(error as Error).message}</div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-fg-muted text-sm">
          You haven't listed anything yet.
        </div>
      ) : (
        <table className="w-full text-sm rounded-lg border bg-bg-elev overflow-hidden">
          <thead className="text-xs text-fg-muted uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Category</th>
              <th className="text-left px-4 py-2">Pricing</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Health</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-4 py-3">
                  <Link href={`/listing/${l.slug}`} className="hover:text-brand">
                    {l.name}
                  </Link>
                  <div className="text-xs text-fg-subtle font-mono">{l.slug}</div>
                </td>
                <td className="px-4 py-3 text-fg-muted">{l.category}</td>
                <td className="px-4 py-3 text-fg-muted">
                  {l.pricing.type === 'free'
                    ? 'Free'
                    : `${l.pricing.amount ?? '?'} ${l.pricing.currency ?? 'USDC'}/call`}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={l.status} />
                </td>
                <td className="px-4 py-3 text-fg-muted">{l.health_status ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/dev/listings/${l.slug}`}
                    className="text-xs text-brand hover:underline"
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Listing['status'] }) {
  const styles: Record<Listing['status'], string> = {
    pending: 'bg-amber-950/40 text-amber-300',
    approved: 'bg-emerald-950/40 text-emerald-300',
    rejected: 'bg-rose-950/40 text-rose-300',
    disabled: 'bg-zinc-800/60 text-zinc-400',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status]}`}>{status}</span>;
}

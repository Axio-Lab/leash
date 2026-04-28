'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{
    items: Array<{ id: string; status: string; pricing: { type: string } }>;
  }>;
};

/**
 * Phase-2 dev dashboard.
 *
 * Real revenue + receipts breakdown ships in Phase 3 (joins `receipts` to
 * `listings` via merchant wallet). For now we surface an at-a-glance
 * health snapshot of the dev's own listings so the page isn't empty.
 */
export default function DevDashboardPage() {
  const { user } = usePrivy();
  const privyId = (user as { id?: string } | null)?.id ?? '';
  const { data } = useSWR(
    privyId ? `/api/listings?owner_privy_id=${encodeURIComponent(privyId)}` : null,
    fetcher,
  );
  const items = data?.items ?? [];
  const totals = {
    pending: items.filter((l) => l.status === 'pending').length,
    approved: items.filter((l) => l.status === 'approved').length,
    paid: items.filter((l) => l.pricing.type !== 'free').length,
  };
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-fg-muted text-sm mt-1">Quick health on your listings.</p>
        </div>
        <Link
          href="/dev/list"
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
        >
          + List a tool
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card label="Pending review" value={totals.pending.toString()} />
        <Card label="Live" value={totals.approved.toString()} />
        <Card label="Paid tools" value={totals.paid.toString()} />
      </div>
      <div className="rounded-lg border border-dashed p-10 text-center text-fg-muted text-sm">
        Revenue charts arrive with Phase 3.
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-bg-elev p-5">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="text-3xl font-semibold tracking-tight mt-1">{value}</div>
    </div>
  );
}

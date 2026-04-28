'use client';

import * as React from 'react';
import useSWR from 'swr';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (r.status === 403) throw new Error('forbidden');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{
    items: Array<{
      id: string;
      slug: string;
      name: string;
      description: string;
      category: string;
      endpoint: string;
      pricing: { type: string; amount?: string; currency?: string };
      tools: Array<{ name: string }>;
      status: string;
      owner_wallet: string;
      created_at: string;
    }>;
  }>;
};

export default function AdminQueuePage() {
  const [status, setStatus] = React.useState<'pending' | 'approved' | 'rejected'>('pending');
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/listings?status=${status}`,
    fetcher,
  );
  const [busy, setBusy] = React.useState<string | null>(null);

  async function decide(id: string, next: 'approved' | 'rejected' | 'disabled') {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/listings/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mutate();
    } finally {
      setBusy(null);
    }
  }

  if (error?.message === 'forbidden') {
    return <div className="text-fg-muted text-sm">You don't have admin access.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Moderation queue</h1>
          <p className="text-fg-muted text-sm mt-1">
            Approve listings before they show up in browse.
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'pending' | 'approved' | 'rejected')}
          className="rounded-md border bg-bg-elev px-3 py-2 text-sm"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      {isLoading ? (
        <div className="text-fg-muted text-sm">Loading…</div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-fg-muted text-sm">
          Empty queue.
        </div>
      ) : (
        <ul className="space-y-3">
          {data.items.map((l) => (
            <li key={l.id} className="rounded-lg border bg-bg-elev p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-fg-muted font-mono">{l.slug}</div>
                </div>
                <div className="flex items-center gap-2">
                  {status === 'pending' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => decide(l.id, 'approved')}
                        disabled={busy === l.id}
                        className="text-xs rounded-md bg-emerald-700 px-2.5 py-1 text-white disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(l.id, 'rejected')}
                        disabled={busy === l.id}
                        className="text-xs rounded-md border px-2.5 py-1 hover:border-border-strong disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => decide(l.id, 'disabled')}
                      disabled={busy === l.id}
                      className="text-xs rounded-md border px-2.5 py-1 hover:border-border-strong disabled:opacity-60"
                    >
                      Disable
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-fg-muted">{l.description}</p>
              <div className="text-xs text-fg-subtle">
                {l.category} · {l.tools.length} tools ·{' '}
                {l.pricing.type === 'free'
                  ? 'free'
                  : `${l.pricing.amount ?? '?'} ${l.pricing.currency ?? 'USDC'}/call`}
              </div>
              <code className="block break-all text-xs font-mono text-fg-muted">{l.endpoint}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import * as React from 'react';
import { Shield } from 'lucide-react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { privyAuthedFetch } from '@/lib/privy-fetch';

/**
 * Admin moderation queue. Access is gated by `LEASH_ADMIN_PRIVY_IDS` on
 * the BFF; if the user isn't on the list the API returns 403 and we
 * render a "no admin" stub.
 */
export default function AdminQueuePage() {
  const { getAccessToken } = usePrivy();
  const [status, setStatus] = React.useState<'pending' | 'approved' | 'rejected'>('pending');
  const fetcher = React.useCallback(
    async (url: string) => {
      const r = await privyAuthedFetch(getAccessToken, url);
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
    },
    [getAccessToken],
  );
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/listings?status=${status}`,
    fetcher,
  );
  const [busy, setBusy] = React.useState<string | null>(null);

  async function decide(id: string, next: 'approved' | 'rejected' | 'disabled') {
    setBusy(id);
    try {
      const res = await privyAuthedFetch(getAccessToken, `/api/admin/listings/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mutate();
    } finally {
      setBusy(null);
    }
  }

  if (error?.message === 'forbidden') {
    return (
      <Card className="bg-aurora text-center p-12 max-w-md mx-auto">
        <Shield className="size-6 mx-auto text-rose-300" />
        <div className="mt-3 font-semibold">Admin only</div>
        <p className="mt-1 text-sm text-fg-muted">Your account isn't in the admin allowlist.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge
            variant="outline"
            className="border-brand/40 font-mono uppercase tracking-widest text-brand-strong"
          >
            <Shield className="size-3 mr-1.5" /> Admin
          </Badge>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Moderation queue</h1>
          <p className="text-fg-muted text-sm mt-1">
            Approve listings before they show up in browse.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border bg-bg-elev p-1">
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={
                'rounded-sm px-3 py-1 text-xs uppercase tracking-wide transition-colors ' +
                (status === s ? 'bg-bg-elev-2 text-fg shadow-sm' : 'text-fg-muted hover:text-fg')
              }
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-fg-muted text-sm">
          <Spinner size="sm" />
          Loading queue
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card className="border-dashed bg-transparent p-10 text-center text-sm text-fg-muted">
          Empty queue.
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.items.map((l) => (
            <li key={l.id}>
              <Card>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{l.name}</div>
                      <div className="font-mono text-xs text-fg-muted">{l.slug}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {status === 'pending' ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => decide(l.id, 'approved')}
                            disabled={busy === l.id}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => decide(l.id, 'rejected')}
                            disabled={busy === l.id}
                          >
                            Reject
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decide(l.id, 'disabled')}
                          disabled={busy === l.id}
                        >
                          Disable
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-fg-muted">{l.description}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                    <Badge variant="outline">{l.category}</Badge>
                    <span>
                      {l.tools.length} tool{l.tools.length === 1 ? '' : 's'}
                    </span>
                    <span>·</span>
                    <span>
                      {l.pricing.type === 'free'
                        ? 'Free'
                        : `${l.pricing.amount ?? '?'} ${l.pricing.currency ?? 'USDC'}/call`}
                    </span>
                  </div>
                  <code className="block break-all text-xs font-mono text-fg-muted">
                    {l.endpoint}
                  </code>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

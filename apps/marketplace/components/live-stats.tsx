'use client';

import useSWR from 'swr';

import { Card } from '@/components/ui/card';

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{
    receipts_total: number;
    volume_total_usdc: string;
    active_agents: number;
    active_listings: number;
  }>;
};

/**
 * Public live counter — pulled from `/v1/stats/public` (60s server cache).
 *
 * Used on marketing landings to make the network feel alive even when
 * the visitor hasn't logged in. Falls back gracefully when the API is
 * down: the placeholder dashes keep the layout from jumping.
 */
export function LiveStats() {
  const { data } = useSWR('/api/stats', fetcher, { refreshInterval: 30_000 });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat
        label="Receipts"
        value={data ? data.receipts_total.toLocaleString() : '—'}
        live={!!data}
      />
      <Stat
        label="USDC settled"
        value={data ? `$${Math.round(Number(data.volume_total_usdc) || 0).toLocaleString()}` : '—'}
        live={!!data}
      />
      <Stat
        label="Active agents"
        value={data ? data.active_agents.toLocaleString() : '—'}
        live={!!data}
      />
      <Stat
        label="Capabilities"
        value={data ? data.active_listings.toLocaleString() : '—'}
        live={!!data}
      />
    </div>
  );
}

function Stat({ label, value, live }: { label: string; value: string; live: boolean }) {
  return (
    <Card className="relative overflow-hidden p-5 text-center">
      {live ? (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-950/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-300 animate-leash-pulse" />
          live
        </span>
      ) : null}
      <div className="font-mono text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-widest text-fg-muted">{label}</div>
    </Card>
  );
}

'use client';

import useSWR from 'swr';

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

export function LiveStats() {
  const { data } = useSWR('/api/stats', fetcher, { refreshInterval: 30_000 });
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
      <Stat label="Proof receipts" value={data ? data.receipts_total.toLocaleString() : '—'} />
      <Stat
        label="USDC settled"
        value={data ? `$${Math.round(Number(data.volume_total_usdc) || 0).toLocaleString()}` : '—'}
      />
      <Stat label="Active agents" value={data ? data.active_agents.toLocaleString() : '—'} />
      <Stat label="Live capabilities" value={data ? data.active_listings.toLocaleString() : '—'} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-bg-elev p-4">
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-fg-muted mt-1">{label}</div>
    </div>
  );
}

import { Activity } from 'lucide-react';
import { DbUnavailableError, getIndexerStatus } from '@/lib/db';
import type { IndexerStatus } from '@/lib/types';
import type { Network } from '@/lib/network';
import { formatRelative } from '@/lib/format';
import { DbUnreachable } from '@/components/empty';

export const dynamic = 'force-dynamic';

type Result = { ok: true; data: IndexerStatus } | { ok: false; message: string };

async function safe(network: Network): Promise<Result> {
  try {
    return { ok: true, data: await getIndexerStatus(network) };
  } catch (err) {
    if (err instanceof DbUnavailableError) return { ok: false, message: err.message };
    throw err;
  }
}

export default async function HealthPage() {
  const [dev, main] = await Promise.all([safe('devnet'), safe('mainnet')]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-[--color-success] motion-safe:animate-pulse" />
          Operational
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Indexer status</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[--color-fg-muted]">
          Per-network freshness for the chain indexer behind explorer.leash.market.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <NetworkCard network="devnet" res={dev} />
        <NetworkCard network="mainnet" res={main} />
      </div>
    </div>
  );
}

function NetworkCard({ network, res }: { network: Network; res: Result }) {
  if (!res.ok) {
    return (
      <div className="card-glow px-5 py-4">
        <h2 className="text-sm font-semibold capitalize tracking-tight">{network}</h2>
        <div className="mt-3">
          <DbUnreachable network={network} message={res.message} />
        </div>
      </div>
    );
  }
  return (
    <div className="card-glow px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold capitalize tracking-tight">{network}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[--color-success]/40 bg-[oklch(0.30_0.16_150/0.4)] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[--color-success]">
          <Activity className="h-3 w-3" />
          live
        </span>
      </div>
      <p className="mt-1 text-xs text-[--color-fg-muted]">
        Last tick: {formatRelative(res.data.cursors.last_run_at)}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
        <Row label="Watchlist">{res.data.watchlist_size.toLocaleString()}</Row>
        <Row label="Cursors">{res.data.cursors.total.toLocaleString()}</Row>
        {Object.entries(res.data.events_last_hour).map(([k, n]) => (
          <Row key={k} label={k}>
            {n.toLocaleString()}
          </Row>
        ))}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">{label}</dt>
      <dd className="text-right font-mono text-[--color-fg]">{children}</dd>
    </>
  );
}

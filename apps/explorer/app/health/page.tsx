import { apiFetch, type IndexerStatus } from '@/lib/api';
import type { Network } from '@/lib/network';
import { formatRelative } from '@/lib/format';
import { ApiUnreachable } from '@/components/empty';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const [dev, main] = await Promise.all([
    apiFetch<IndexerStatus>('devnet', '/v1/indexer/status'),
    apiFetch<IndexerStatus>('mainnet', '/v1/indexer/status'),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">Operational</p>
        <h1 className="text-2xl font-semibold tracking-tight">Indexer status</h1>
        <p className="text-sm text-[--color-fg-muted]">
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

function NetworkCard({
  network,
  res,
}: {
  network: Network;
  res: Awaited<ReturnType<typeof apiFetch<IndexerStatus>>>;
}) {
  if (!res.ok) {
    return (
      <div className="card px-5 py-4">
        <h2 className="text-sm font-semibold capitalize">{network}</h2>
        <ApiUnreachable network={network} message={res.message} />
      </div>
    );
  }
  return (
    <div className="card px-5 py-4">
      <h2 className="text-sm font-semibold capitalize">{network}</h2>
      <p className="mt-1 text-xs text-[--color-fg-muted]">
        Last tick: {formatRelative(res.data.cursors.last_run_at)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
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

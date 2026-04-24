import Link from 'next/link';
import { Activity, FileSignature, Wallet, Zap } from 'lucide-react';
import { apiFetch, type EventPage, type ReceiptPage, type IndexerStatus } from '@/lib/api';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { EventsTable } from '@/components/events-table';
import { ReceiptsTable } from '@/components/receipts-table';
import { ApiUnreachable } from '@/components/empty';
import { SearchBar } from '@/components/search-bar';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const network = await getNetwork();

  const [eventsRes, statusRes] = await Promise.all([
    apiFetch<EventPage>(network, '/v1/events?limit=15'),
    apiFetch<IndexerStatus>(network, '/v1/indexer/status'),
  ]);

  // Receipts feed is per-agent on the API; surface a flat "recent" view
  // by reusing the events stream filtered to receipt.published.
  const recentReceiptsRes = await apiFetch<EventPage>(
    network,
    '/v1/events?kind=receipt.published&limit=10',
  );

  const events = eventsRes.ok ? eventsRes.data.items : [];
  const receiptEvents = recentReceiptsRes.ok ? recentReceiptsRes.data.items : [];

  // Hydrate the receipt rows by fetching their hashes individually.
  // For a recent feed, we use the receipt event metadata that the
  // API stamps with `receipt_hash` when ingesting.
  const recentReceipts = await hydrateRecentReceipts(network, receiptEvents);

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
            {networkToSlug(network)} · live feed
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Leash Explorer</h1>
          <p className="max-w-2xl text-sm text-[--color-fg-muted]">
            Every agent created, every executive bound, every receipt published — visible across
            devnet and mainnet. Search any address, transaction signature, receipt hash, or event
            id.
          </p>
        </div>
        <div className="max-w-2xl">
          <SearchBar size="lg" />
        </div>
        <StatusStrip status={statusRes.ok ? statusRes.data : null} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <Link href="/events" className="text-xs text-[--color-fg-muted] hover:text-[--color-fg]">
            view all →
          </Link>
        </div>
        {eventsRes.ok ? (
          <EventsTable rows={events} network={network} />
        ) : (
          <ApiUnreachable network={network} message={eventsRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent receipts</h2>
          <span className="text-xs text-[--color-fg-subtle]">kind = receipt.published</span>
        </div>
        {recentReceiptsRes.ok ? (
          <ReceiptsTable rows={recentReceipts} network={network} />
        ) : (
          <ApiUnreachable network={network} message={recentReceiptsRes.message} />
        )}
      </section>
    </div>
  );
}

async function hydrateRecentReceipts(
  network: Awaited<ReturnType<typeof getNetwork>>,
  receiptEvents: EventPage['items'],
) {
  const seen = new Set<string>();
  const out = [] as ReceiptPage['items'];
  for (const ev of receiptEvents) {
    const hash = (ev.metadata['receipt_hash'] as string | undefined) ?? null;
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    const r = await apiFetch<
      { receipt: ReceiptPage['items'][number] } | ReceiptPage['items'][number]
    >(network, `/v1/receipts/by-hash/${encodeURIComponent(hash)}`);
    if (r.ok) {
      const item =
        typeof (r.data as { receipt?: unknown }).receipt === 'object'
          ? (r.data as { receipt: ReceiptPage['items'][number] }).receipt
          : (r.data as ReceiptPage['items'][number]);
      out.push(item);
    }
    if (out.length >= 10) break;
  }
  return out;
}

function StatusStrip({ status }: { status: IndexerStatus | null }) {
  if (!status) {
    return (
      <div className="card flex flex-wrap items-center gap-6 px-5 py-3 text-xs text-[--color-fg-muted]">
        Indexer status unavailable on this network.
      </div>
    );
  }
  return (
    <div className="card flex flex-wrap items-center gap-6 px-5 py-3 text-xs text-[--color-fg-muted]">
      <Stat icon={<Wallet className="h-3.5 w-3.5" />} label="Watchlist">
        {status.watchlist_size.toLocaleString()}
      </Stat>
      <Stat icon={<Activity className="h-3.5 w-3.5" />} label="Cursors">
        {status.cursors.total.toLocaleString()}
      </Stat>
      <Stat icon={<Zap className="h-3.5 w-3.5" />} label="Last tick">
        {formatRelative(status.cursors.last_run_at)}
      </Stat>
      <Stat icon={<FileSignature className="h-3.5 w-3.5" />} label="Receipts/hr">
        {(status.events_last_hour['receipt.published'] ?? 0).toLocaleString()}
      </Stat>
    </div>
  );
}

function Stat({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[--color-brand]">{icon}</span>
      <span className="uppercase tracking-wider text-[--color-fg-subtle]">{label}</span>
      <span className="font-mono text-[--color-fg]">{children}</span>
    </span>
  );
}

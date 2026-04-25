import Link from 'next/link';
import { Activity, FileSignature, Wallet, Zap } from 'lucide-react';
import { DbUnavailableError, getIndexerStatus, listEvents, listRecentReceipts } from '@/lib/db';
import type { EventPage, IndexerStatus, ReceiptPage } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { EventsTable } from '@/components/events-table';
import { ReceiptsTable } from '@/components/receipts-table';
import { DbUnreachable } from '@/components/empty';
import { SearchBar } from '@/components/search-bar';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}

export default async function HomePage() {
  const network = await getNetwork();

  const [eventsRes, statusRes, recentReceiptsRes] = await Promise.all([
    safe<EventPage>(() => listEvents({ network, limit: 15 })),
    safe<IndexerStatus>(() => getIndexerStatus(network)),
    safe<ReceiptPage>(() => listRecentReceipts({ network, limit: 15 })),
  ]);

  const events = eventsRes.ok ? eventsRes.data.items : [];
  const recentReceipts = recentReceiptsRes.ok ? recentReceiptsRes.data.items : [];

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
            {networkToSlug(network)} · live feed
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Leash Explorer</h1>
          <p className="max-w-2xl text-sm text-[--color-fg-muted]">
            Every agent created, every executive bound, every receipt published id.
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
          <DbUnreachable network={network} message={eventsRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent receipts</h2>
          <Link
            href="/receipts"
            className="text-xs text-[--color-fg-muted] hover:text-[--color-fg]"
          >
            view all →
          </Link>
        </div>
        {recentReceiptsRes.ok ? (
          <ReceiptsTable rows={recentReceipts} network={network} />
        ) : (
          <DbUnreachable network={network} message={recentReceiptsRes.message} />
        )}
      </section>
    </div>
  );
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

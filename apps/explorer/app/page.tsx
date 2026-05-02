import Link from 'next/link';
import { Activity, FileSignature, Wallet, Zap, ArrowRight } from 'lucide-react';
import {
  DbUnavailableError,
  getCounterpartiesForTxs,
  getIndexerStatus,
  listEvents,
  listRecentReceipts,
} from '@/lib/db';
import type { EventPage, IndexerStatus, ReceiptPage } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { EventsTable } from '@/components/events-table';
import { ReceiptsTable } from '@/components/receipts-table';
import { DbUnreachable } from '@/components/empty';
import { SearchBar } from '@/components/search-bar';
import { LiveRefresh } from '@/components/live-refresh';
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

  // Resolve payer/receiver per row from the receipts table itself —
  // best-effort: a DB hiccup here just falls back to "—" rather than
  // failing the whole homepage render.
  const recentTxSigs = recentReceipts
    .map((r) => r.tx_sig)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  const counterpartiesRes = await safe(() => getCounterpartiesForTxs(network, recentTxSigs));
  const counterparties = counterpartiesRes.ok ? counterpartiesRes.data : undefined;

  return (
    <div className="space-y-10">
      {/* Hero — frosted glass over the body's aurora gradient. The grid
          overlay reads as a faint tech-print, mirroring apps/agents. */}
      <section className="card-glow relative overflow-hidden bg-grid px-6 py-8 sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(60%_50%_at_30%_30%,#000_30%,transparent_75%)]" />
        <div className="relative space-y-5">
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-[--color-brand] motion-safe:animate-pulse" />
              {networkToSlug(network)} · live feed
            </p>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              <span className="bg-gradient-to-br from-[--color-fg] via-[--color-fg] to-[--color-fg-muted] bg-clip-text text-transparent">
                Every receipt, every event, every agent.
              </span>
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-[--color-fg-muted]">
              The receipt engine for agent-to-agent commerce. Search any agent, transaction,
              receipt, or event ID across both clusters — settled in real SPL stables on Solana.
            </p>
          </div>
          <div className="max-w-2xl">
            <SearchBar size="lg" />
          </div>
          <StatusStrip status={statusRes.ok ? statusRes.data : null} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
          <div className="flex items-center gap-3">
            <LiveRefresh network={network} intervalSec={5} />
            <Link
              href="/events"
              className="group inline-flex items-center gap-1 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-xs text-[--color-fg-muted] backdrop-blur-md transition-colors hover:border-[--color-border-strong] hover:text-[--color-fg]"
            >
              View all
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        {eventsRes.ok ? (
          <EventsTable rows={events} network={network} />
        ) : (
          <DbUnreachable network={network} message={eventsRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Recent receipts</h2>
          <Link
            href="/receipts"
            className="group inline-flex items-center gap-1 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-xs text-[--color-fg-muted] backdrop-blur-md transition-colors hover:border-[--color-border-strong] hover:text-[--color-fg]"
          >
            View all
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        {recentReceiptsRes.ok ? (
          <ReceiptsTable rows={recentReceipts} network={network} counterparties={counterparties} />
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
      <div className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/60 px-5 py-3 text-xs text-[--color-fg-muted] backdrop-blur-md">
        Indexer status unavailable on this network.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
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
    <div className="group flex items-center gap-3 rounded-xl border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-2.5 backdrop-blur-md transition-colors hover:border-[--color-border-strong]">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[--color-brand-soft]/40 text-[--color-brand-strong] ring-1 ring-inset ring-[--color-brand-soft]">
        {icon}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">{label}</div>
        <div className="truncate font-mono text-sm text-[--color-fg]">{children}</div>
      </div>
    </div>
  );
}

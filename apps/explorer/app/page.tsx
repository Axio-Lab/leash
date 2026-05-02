import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  DbUnavailableError,
  getCounterpartiesForTxs,
  listEvents,
  listRecentReceipts,
} from '@/lib/db';
import type { EventPage, ReceiptPage } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { EventsTable } from '@/components/events-table';
import { ReceiptsTable } from '@/components/receipts-table';
import { DbUnreachable } from '@/components/empty';
import { LiveRefresh } from '@/components/live-refresh';
import { AgentNetworkBackground } from '@/components/agent-network-background';

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

  const [eventsRes, recentReceiptsRes] = await Promise.all([
    safe<EventPage>(() => listEvents({ network, limit: 15 })),
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
    <div className="space-y-12">
      {/* Hero — compact card with the same agent-network animation used on
          apps/agents (drifting nodes + brand-coloured signal pulses). The
          headline reads as plain bright foreground with a `text-brand`
          accent on the punchline, mirroring the agents landing. No
          eyebrow (network is already in the topbar) and no inline search
          (the topbar carries one). */}
      <section className="card-glow relative isolate overflow-hidden px-5 py-7 sm:px-10 sm:py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-brand/15 blur-[100px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-24 size-80 rounded-full bg-brand-soft/30 blur-[120px]"
        />
        <AgentNetworkBackground />
        <div className="relative">
          <h1 className="text-balance text-2xl font-semibold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
            The receipt engine for <span className="text-brand">agent-to-agent commerce</span>
          </h1>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
          <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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

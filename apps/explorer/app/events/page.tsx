import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { DbUnavailableError, listEvents } from '@/lib/db';
import type { EventPage } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { EventsTable } from '@/components/events-table';
import { DbUnreachable } from '@/components/empty';
import { LiveRefresh } from '@/components/live-refresh';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

/**
 * Curated filter set — one button per category that actually shows
 * results today AND maps cleanly onto a single indexer kind. We
 * deliberately don't enumerate every `EventKind` because most of
 * them have ~zero rows on devnet (or are internal lifecycle steps
 * like `submit.raw` / `agent.delegation.set`) and clicking through
 * an empty filter is a worse UX than not having the chip at all.
 */
const KIND_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'receipt.published', label: 'Proof receipts' },
  { value: 'agent.treasury.withdraw', label: 'Withdraw' },
  { value: 'agent.treasury.fund', label: 'Fund' },
];

type Props = {
  searchParams: Promise<{ kind?: string; cursor?: string }>;
};

export default async function EventsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const network = await getNetwork();

  let res: { ok: true; data: EventPage } | { ok: false; message: string };
  try {
    const data = await listEvents({
      network,
      ...(sp.kind ? { kind: sp.kind } : {}),
      ...(sp.cursor ? { cursor: sp.cursor } : {}),
      limit: 50,
    });
    res = { ok: true, data };
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      res = { ok: false, message: err.message };
    } else {
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Event feed</h1>
          <p className="whitespace-normal text-sm text-[--color-fg-muted]">
            Every state-changing call the indexer has tracked, in lifecycle order — prepared,
            submitted, confirmed, or failed.
          </p>
        </div>
        {sp.cursor ? null : <LiveRefresh network={network} intervalSec={5} />}
      </header>

      <nav
        aria-label="Filter events by kind"
        className="flex flex-wrap gap-1.5 rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 p-1.5 backdrop-blur-md"
      >
        {KIND_OPTIONS.map((opt) => {
          const href = opt.value ? `/events?kind=${opt.value}` : '/events';
          const active = (sp.kind ?? '') === opt.value;
          return (
            <Link
              key={opt.value || 'all'}
              href={href}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-all',
                active
                  ? 'bg-[--color-brand-soft] text-[--color-fg] shadow-[0_0_0_1px_oklch(0.66_0.19_268/0.4),0_8px_24px_-12px_oklch(0.66_0.19_268/0.5)]'
                  : 'text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]/60 hover:text-[--color-fg]',
              )}
            >
              {opt.label}
            </Link>
          );
        })}
      </nav>

      {res.ok ? (
        <>
          <EventsTable rows={res.data.items} network={network} />
          {res.data.next_cursor ? (
            <div className="flex justify-end">
              <Link
                href={`/events?${new URLSearchParams({
                  ...(sp.kind ? { kind: sp.kind } : {}),
                  cursor: res.data.next_cursor,
                }).toString()}`}
                className="group inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-4 py-1.5 text-xs text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:text-[--color-fg]"
              >
                Older
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          ) : null}
        </>
      ) : (
        <DbUnreachable network={network} message={res.message} />
      )}
    </div>
  );
}

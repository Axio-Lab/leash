import Link from 'next/link';
import { ArrowRight, Receipt } from 'lucide-react';
import {
  DbUnavailableError,
  getCounterpartiesForTxs,
  listProtocolFeeTotals,
  listRecentReceipts,
} from '@/lib/db';
import type { ReceiptPage, ReceiptRow } from '@/lib/types';
import type { Network } from '@/lib/network';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { ReceiptsTable } from '@/components/receipts-table';
import { DbUnreachable } from '@/components/empty';
import { LiveRefresh } from '@/components/live-refresh';
import { formatTokenAmount, tokenInfoFor } from '@/lib/token-info';
import { cn } from '@/lib/cn';

/** Best-effort counterparty join: never fails the page render. */
async function loadCounterparties(network: Network, rows: ReceiptRow[]) {
  const sigs = rows
    .map((r) => r.tx_sig)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  try {
    return await getCounterpartiesForTxs(network, sigs);
  } catch {
    return undefined;
  }
}

export const dynamic = 'force-dynamic';

const KIND_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'earn', label: 'Earn' },
  { value: 'spend', label: 'Spend' },
] as const;

type Props = {
  searchParams: Promise<{ kind?: 'spend' | 'earn'; cursor?: string }>;
};

export default async function ReceiptsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const network = await getNetwork();

  let res: { ok: true; data: ReceiptPage } | { ok: false; message: string };
  try {
    const data = await listRecentReceipts({
      network,
      limit: 50,
      ...(sp.kind ? { kind: sp.kind } : {}),
      ...(sp.cursor ? { cursor: sp.cursor } : {}),
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
          <p className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-[--color-brand] motion-safe:animate-pulse" />
            {networkToSlug(network)} · receipts
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Receipt feed</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-[--color-fg-muted]">
            Every x402 settlement that any agent has emitted. Earn receipts come from paywall-served
            calls; spend receipts come from buyer-side payments.
          </p>
        </div>
        {sp.cursor ? null : <LiveRefresh network={network} intervalSec={5} />}
      </header>

      <nav
        aria-label="Filter receipts by kind"
        className="flex flex-wrap gap-1.5 rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 p-1.5 backdrop-blur-md"
      >
        {KIND_OPTIONS.map((opt) => {
          const href = opt.value ? `/receipts?kind=${opt.value}` : '/receipts';
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

      <ProtocolFeesPanel network={network} />

      {res.ok ? (
        <>
          <ReceiptsTable
            rows={res.data.items}
            network={network}
            counterparties={await loadCounterparties(network, res.data.items)}
          />
          {res.data.next_cursor ? (
            <div className="flex justify-end">
              <Link
                href={`/receipts?${new URLSearchParams({
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

/**
 * Protocol fee revenue summary, grouped by mint. Renders nothing when
 * no `protocol.fee.collected` events have landed yet on this network
 * — keeps the page clean for fresh deploys / local dev.
 */
async function ProtocolFeesPanel({ network }: { network: Network }) {
  let totals: Awaited<ReturnType<typeof listProtocolFeeTotals>>;
  try {
    totals = await listProtocolFeeTotals(network);
  } catch {
    return null;
  }
  if (totals.length === 0) return null;

  return (
    <section className="card-glow px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[oklch(0.32_0.16_85/0.55)] text-[oklch(0.9_0.18_95)] ring-1 ring-inset ring-[oklch(0.5_0.2_95/0.35)]">
            <Receipt className="h-3 w-3" />
          </span>
          Protocol fees collected
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
          {networkToSlug(network)}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {totals.map((t, i) => {
          const info = tokenInfoFor(network, t.mint);
          const formatted = formatTokenAmount(t.totalAtomic, info);
          return (
            <li
              key={`${t.mint ?? 'native'}-${i}`}
              className="flex items-center justify-between rounded-lg border border-[--color-border] bg-[--color-bg-elev-2]/50 px-3 py-2.5 text-xs backdrop-blur-md"
            >
              <span className="font-medium text-[--color-fg-muted]">
                {info.symbol ?? t.currency ?? 'unknown'}
              </span>
              <span className="text-right">
                <div className="font-mono text-sm text-[--color-fg]">{formatted}</div>
                <div className="text-[10px] text-[--color-fg-subtle]">
                  {t.count} settled call{t.count === 1 ? '' : 's'}
                </div>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

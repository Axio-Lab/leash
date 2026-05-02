import Link from 'next/link';
import { ArrowRight, DollarSign, Receipt as ReceiptIcon, Wallet } from 'lucide-react';
import {
  DbUnavailableError,
  getCounterpartiesForTxs,
  getSettlementTotals,
  listRecentReceipts,
} from '@/lib/db';
import type { ReceiptPage, ReceiptRow } from '@/lib/types';
import type { Network } from '@/lib/network';
import { getNetwork } from '@/lib/server-network';
import { ReceiptsTable } from '@/components/receipts-table';
import { DbUnreachable } from '@/components/empty';
import { LiveRefresh } from '@/components/live-refresh';
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

  // Totals are best-effort — a DB blip just hides the panel rather
  // than failing the whole page render.
  let totals: Awaited<ReturnType<typeof getSettlementTotals>> | null = null;
  try {
    totals = await getSettlementTotals(network);
  } catch {
    totals = null;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Receipt feed</h1>
          <p className="whitespace-normal text-sm text-[--color-fg-muted]">
            Every x402 settlement that any agent has emitted. Earn receipts come from paywall-served
            calls; spend receipts come from buyer-side payments.
          </p>
        </div>
        {sp.cursor ? null : <LiveRefresh network={network} intervalSec={5} />}
      </header>

      {totals && totals.settled_count > 0 ? <SettlementTotalsStrip totals={totals} /> : null}

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
 * All-time settlement KPIs. Three cards — gross volume, protocol fees,
 * settled call count — each with a brand-tinted top edge that lights
 * up on hover, matching the agent treasury cards.
 *
 * The two USD figures combine USDC, USDG, and USDT (all 1:1, all
 * 6-decimal stables) into a single $-denominated total so the user
 * doesn't have to mentally sum a per-mint table.
 */
function SettlementTotalsStrip({
  totals,
}: {
  totals: { gross_usd: number; fees_usd: number; settled_count: number };
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <KpiCard
        label="Total settled"
        value={formatUsd(totals.gross_usd)}
        sublabel="across USDC + USDG + USDT"
        icon={<DollarSign className="h-3.5 w-3.5" />}
      />
      <KpiCard
        label="Protocol fees"
        value={formatUsd(totals.fees_usd)}
        sublabel={`${formatBps(totals.gross_usd, totals.fees_usd)} effective`}
        icon={<Wallet className="h-3.5 w-3.5" />}
      />
      <KpiCard
        label="Settled calls"
        value={totals.settled_count.toLocaleString()}
        sublabel="earn receipts"
        icon={<ReceiptIcon className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sublabel,
  icon,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card group relative overflow-hidden px-5 py-4 transition-all hover:border-[--color-brand-soft]/60">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[--color-brand-strong]/40 to-transparent opacity-60 transition-opacity group-hover:opacity-100" />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[--color-brand-soft]/40 text-[--color-brand-strong] ring-1 ring-inset ring-[--color-brand-soft]">
          {icon}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
          {label}
        </span>
      </div>
      <div className="mt-3 font-mono text-2xl tracking-tight text-[--color-fg]">{value}</div>
      <div className="mt-1 text-[11px] text-[--color-fg-muted]">{sublabel}</div>
    </div>
  );
}

function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) {
    const fixed = amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return `$${fixed}`;
  }
  if (amount < 1) return `$${amount.toFixed(2)}`;
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function formatBps(gross: number, fees: number): string {
  if (!Number.isFinite(gross) || gross <= 0) return '—';
  const bps = Math.round((fees / gross) * 10_000);
  return `${bps} bps`;
}

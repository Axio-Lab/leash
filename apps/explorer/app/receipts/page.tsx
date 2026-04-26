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
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
            {networkToSlug(network)} · receipts
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Receipt feed</h1>
          <p className="max-w-2xl text-sm text-[--color-fg-muted]">
            Every x402 settlement that any agent has emitted. Earn receipts come from paywall-served
            calls; spend receipts come from buyer-side payments.
          </p>
        </div>
        {sp.cursor ? null : <LiveRefresh network={network} intervalSec={5} />}
      </header>

      <nav className="flex flex-wrap gap-2">
        {KIND_OPTIONS.map((opt) => {
          const href = opt.value ? `/receipts?kind=${opt.value}` : '/receipts';
          const active = (sp.kind ?? '') === opt.value;
          return (
            <a
              key={opt.value || 'all'}
              href={href}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? 'border-[--color-brand-strong] bg-[--color-brand-soft] text-[--color-fg]'
                  : 'border-[--color-border] bg-[--color-bg-elev] text-[--color-fg-muted] hover:text-[--color-fg]'
              }`}
            >
              {opt.label}
            </a>
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
              <a
                href={`/receipts?${new URLSearchParams({
                  ...(sp.kind ? { kind: sp.kind } : {}),
                  cursor: res.data.next_cursor,
                }).toString()}`}
                className="rounded-md border border-[--color-border] bg-[--color-bg-elev] px-3 py-1.5 text-xs text-[--color-fg-muted] hover:text-[--color-fg]"
              >
                Older →
              </a>
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
    <section className="rounded-lg border border-[--color-border] bg-[--color-bg-elev] px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Protocol fees collected</h2>
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
              className="flex items-center justify-between rounded-md bg-[oklch(0.18_0.02_280)] px-3 py-2 text-xs"
            >
              <span className="text-[--color-fg-muted]">
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

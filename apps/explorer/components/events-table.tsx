import Link from 'next/link';
import type { EventRow } from '@/lib/types';
import { describeEvent } from '@/lib/event-label';
import { formatRelative } from '@/lib/format';
import { EventBadge, PhaseBadge } from './event-badge';
import { Mono } from './mono';
import { Empty } from './empty';
import type { Network } from '@/lib/network';
import { solscanTxUrl } from '@/lib/solscan';
import { formatTokenAmount, tokenInfoFor } from '@/lib/token-info';

/**
 * What goes in the activity feed's "Reference" column.
 *
 * Two render modes share the same row:
 *
 * - `value` is an opaque identifier (payment-link id, receipt hash,
 *   client reference) → we hand it to `<Mono>` for copy + truncation.
 * - `mono: false` → the value is plain prose ("99 USDG") and should
 *   render as a normal text token without copy/truncate noise.
 *
 * Treasury kinds use the prose form so the column reads
 * `WITHDRAW 99 USDG` / `FUND 100 USDG` instead of `—`. The label
 * mirrors the action so a user scanning the feed sees the *direction*
 * of the movement before they have to parse the amount.
 */
type Ref = { label: string; value: string; href?: string; mono?: boolean };

const SOL_DECIMALS = 9;

function referenceFor(row: EventRow, network: Network): Ref | null {
  const md = row.metadata ?? {};

  const linkId = md['payment_link_id'];
  if (typeof linkId === 'string' && linkId.length > 0) {
    return { label: 'link', value: linkId };
  }
  const rh = md['receipt_hash'];
  if (typeof rh === 'string' && rh.length > 0) {
    return { label: 'receipt', value: rh, href: `/receipt/${rh}` };
  }

  switch (row.kind) {
    case 'agent.treasury.withdraw':
    case 'agent.treasury.fund': {
      const info = tokenInfoFor(network, row.mint);
      const amount = row.amount_atomic
        ? formatTokenAmount(row.amount_atomic, info, { withUsd: false })
        : info.symbol;
      return {
        label: row.kind === 'agent.treasury.fund' ? 'fund' : 'withdraw',
        value: amount,
        mono: false,
      };
    }
    case 'agent.treasury.withdraw_sol':
    case 'agent.treasury.fund_sol': {
      const amount = row.amount_atomic
        ? formatTokenAmount(
            row.amount_atomic,
            { symbol: 'SOL', decimals: SOL_DECIMALS, isStable: false },
            { withUsd: false },
          )
        : 'SOL';
      return {
        label: row.kind === 'agent.treasury.fund_sol' ? 'fund' : 'withdraw',
        value: amount,
        mono: false,
      };
    }
    case 'agent.treasury.provision':
      return { label: 'provision', value: 'ATAs', mono: false };
  }

  const cref = row.client_reference;
  if (cref && cref.length > 0) {
    return { label: 'ref', value: cref };
  }
  return null;
}

export function EventsTable({
  rows,
  network,
  emptyTitle = 'No events yet.',
}: {
  rows: EventRow[];
  network: Network;
  emptyTitle?: string;
}) {
  if (rows.length === 0) {
    return (
      <Empty
        title={emptyTitle}
        description="As soon as activity hits the network you'll see it here."
      />
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      {/* `overflow-x-auto` keeps the wide layout scrollable on tablet
          breakpoints; the `hidden md:table-cell` columns drop off on
          phones so what's left fits comfortably without sideways
          scrolling. The full-width row link still lives in the first
          cell so the entire row remains tappable. */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[--color-border] text-sm">
          <thead className="bg-[--color-bg-elev]/40 text-left text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
            <tr>
              <th className="px-3 py-2.5 font-medium sm:px-4">Kind</th>
              <th
                className="hidden px-3 py-2.5 font-medium md:table-cell"
                title="Lifecycle position: prepared → submitted → confirmed (or failed)."
              >
                Status <span className="cursor-help text-[--color-fg-muted]">ⓘ</span>
              </th>
              <th className="px-3 py-2.5 font-medium">Agent</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">Reference</th>
              <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Signature</th>
              <th className="px-3 py-2.5 text-right font-medium sm:px-4">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-border]/60">
            {rows.map((row, idx) => {
              const desc = describeEvent(row);
              const ref = referenceFor(row, network);
              const rowHref = row.signature ? `/tx/${row.signature}` : `/event/${row.id}`;
              const rowLabel = row.signature
                ? `View transaction ${row.signature}`
                : `View event ${row.id}`;
              return (
                <tr
                  key={row.id}
                  className="group relative motion-safe:[animation:var(--animate-row-in)] transition-colors hover:bg-[--color-brand-soft]/15"
                  style={{ animationDelay: `${Math.min(idx, 12) * 24}ms` }}
                >
                  <td className="p-0">
                    <Link
                      href={rowHref}
                      aria-label={rowLabel}
                      className="absolute inset-0 z-0"
                      tabIndex={-1}
                    />
                    <div className="relative z-10 px-3 py-2.5 align-middle sm:px-4">
                      <Link href={`/event/${row.id}`} className="inline-flex items-center gap-2">
                        <EventBadge descriptor={desc} />
                        <span className="hidden text-xs text-[--color-fg-muted] group-hover:text-[--color-fg] sm:inline">
                          {desc.label}
                        </span>
                      </Link>
                    </div>
                  </td>
                  <td className="relative z-10 hidden px-3 py-2.5 align-middle md:table-cell">
                    <PhaseBadge phase={row.phase} />
                  </td>
                  <td className="relative z-10 px-3 py-2.5 align-middle">
                    <Mono
                      value={row.agent_asset}
                      href={row.agent_asset ? `/agent/${row.agent_asset}` : undefined}
                    />
                  </td>
                  <td className="relative z-10 hidden px-3 py-2.5 align-middle md:table-cell">
                    {ref ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
                          {ref.label}
                        </span>
                        {ref.mono === false ? (
                          <span className="text-xs text-[--color-fg]">{ref.value}</span>
                        ) : (
                          <Mono value={ref.value} href={ref.href} />
                        )}
                      </span>
                    ) : (
                      <span className="text-[--color-fg-subtle]">—</span>
                    )}
                  </td>
                  <td className="relative z-10 hidden px-3 py-2.5 align-middle lg:table-cell">
                    <Mono
                      value={row.signature}
                      href={row.signature ? `/tx/${row.signature}` : undefined}
                      external={row.signature ? solscanTxUrl(network, row.signature) : undefined}
                    />
                  </td>
                  <td className="relative z-10 px-3 py-2.5 text-right align-middle text-xs text-[--color-fg-muted] sm:px-4">
                    {formatRelative(row.ts)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

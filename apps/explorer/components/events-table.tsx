import Link from 'next/link';
import type { EventRow } from '@/lib/types';
import { describeEvent } from '@/lib/event-label';
import { formatRelative } from '@/lib/format';
import { EventBadge, PhaseBadge } from './event-badge';
import { Mono } from './mono';
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

  // Treasury rows: show the action + the formatted amount so the
  // column carries real signal even without an upstream id to point
  // at. Falls through to `client_reference` if something exotic comes
  // in without an `amount_atomic`.
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
      <div className="rounded-lg border border-dashed border-[--color-border] bg-[--color-bg-elev] px-6 py-10 text-center text-sm text-[--color-fg-muted]">
        {emptyTitle}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[--color-border] bg-[--color-bg-elev]">
      <table className="min-w-full divide-y divide-[--color-border] text-sm">
        <thead className="bg-[oklch(0.18_0.02_280)] text-left text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
          <tr>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th
              className="px-3 py-2 font-medium"
              title="Lifecycle position: prepared → submitted → confirmed (or failed)."
            >
              Status <span className="cursor-help text-[--color-fg-muted]">ⓘ</span>
            </th>
            <th className="px-3 py-2 font-medium">Agent</th>
            <th className="px-3 py-2 font-medium">Reference</th>
            <th className="px-3 py-2 font-medium">Signature</th>
            <th className="px-3 py-2 font-medium text-right">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[--color-border]">
          {rows.map((row) => {
            const desc = describeEvent(row);
            const ref = referenceFor(row, network);
            // Whole-row click target: tx detail when we have a signature
            // (the most useful destination for activity rows), event
            // detail otherwise (e.g. for prepared events without a tx).
            const rowHref = row.signature ? `/tx/${row.signature}` : `/event/${row.id}`;
            const rowLabel = row.signature
              ? `View transaction ${row.signature}`
              : `View event ${row.id}`;
            return (
              <tr key={row.id} className="group relative hover:bg-[oklch(0.2_0.02_280_/_0.6)]">
                {/* Stretched link sits behind the inline cell links so they
                    retain their own click targets (agent / signature /
                    reference deep-links). */}
                <td className="p-0">
                  <Link
                    href={rowHref}
                    aria-label={rowLabel}
                    className="absolute inset-0 z-0"
                    tabIndex={-1}
                  />
                  <div className="relative z-10 px-3 py-2.5 align-middle">
                    <Link href={`/event/${row.id}`} className="inline-flex items-center gap-2">
                      <EventBadge descriptor={desc} />
                      <span className="text-xs text-[--color-fg-muted]">{desc.label}</span>
                    </Link>
                  </div>
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle">
                  <PhaseBadge phase={row.phase} />
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle">
                  <Mono
                    value={row.agent_asset}
                    href={row.agent_asset ? `/agent/${row.agent_asset}` : undefined}
                  />
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle">
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
                <td className="relative z-10 px-3 py-2.5 align-middle">
                  <Mono
                    value={row.signature}
                    href={row.signature ? `/tx/${row.signature}` : undefined}
                    external={row.signature ? solscanTxUrl(network, row.signature) : undefined}
                  />
                </td>
                <td className="relative z-10 px-3 py-2.5 text-right align-middle text-xs text-[--color-fg-muted]">
                  {formatRelative(row.ts)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

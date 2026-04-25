import Link from 'next/link';
import type { EventRow } from '@/lib/types';
import { describeEvent } from '@/lib/event-label';
import { formatRelative } from '@/lib/format';
import { EventBadge, PhaseBadge } from './event-badge';
import { Mono } from './mono';
import type { Network } from '@/lib/network';
import { solscanTxUrl } from '@/lib/solscan';

/**
 * Pull the most relevant per-row identifier out of `metadata` so the
 * activity feed has a quick "what was this about" column without
 * forcing the user to click through. We surface payment_link_id
 * first (most common high-signal row), then receipt_hash for raw
 * receipt events. The full value is returned (not pre-truncated) so
 * the cell can render it through the copy-aware `Mono` component.
 */
function referenceFor(row: EventRow): { label: string; value: string; href?: string } | null {
  const md = row.metadata ?? {};
  const linkId = md['payment_link_id'];
  if (typeof linkId === 'string' && linkId.length > 0) {
    return { label: 'link', value: linkId };
  }
  const rh = md['receipt_hash'];
  if (typeof rh === 'string' && rh.length > 0) {
    return { label: 'receipt', value: rh, href: `/receipt/${rh}` };
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
            const ref = referenceFor(row);
            return (
              <tr key={row.id} className="hover:bg-[oklch(0.2_0.02_280_/_0.6)]">
                <td className="px-3 py-2.5 align-middle">
                  <Link href={`/event/${row.id}`} className="inline-flex items-center gap-2">
                    <EventBadge descriptor={desc} />
                    <span className="text-xs text-[--color-fg-muted]">{desc.label}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 align-middle">
                  <PhaseBadge phase={row.phase} />
                </td>
                <td className="px-3 py-2.5 align-middle">
                  <Mono
                    value={row.agent_asset}
                    href={row.agent_asset ? `/agent/${row.agent_asset}` : undefined}
                  />
                </td>
                <td className="px-3 py-2.5 align-middle">
                  {ref ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
                        {ref.label}
                      </span>
                      <Mono value={ref.value} href={ref.href} />
                    </span>
                  ) : (
                    <span className="text-[--color-fg-subtle]">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-middle">
                  <Mono
                    value={row.signature}
                    href={row.signature ? `/tx/${row.signature}` : undefined}
                    external={row.signature ? solscanTxUrl(network, row.signature) : undefined}
                  />
                </td>
                <td className="px-3 py-2.5 text-right align-middle text-xs text-[--color-fg-muted]">
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

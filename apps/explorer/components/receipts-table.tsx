import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { ReceiptRow } from '@/lib/types';
import type { Network } from '@/lib/network';
import { formatRelative } from '@/lib/format';
import { Mono } from './mono';
import { formatTokenAmount, tokenInfoFor } from '@/lib/token-info';

const KIND_CLS = {
  spend: 'bg-[oklch(0.32_0.13_320/0.5)] text-[oklch(0.85_0.13_320)]',
  earn: 'bg-[oklch(0.30_0.16_150/0.5)] text-[oklch(0.85_0.16_150)]',
} as const;

const DECISION_CLS = {
  allow: 'bg-[oklch(0.30_0.16_150/0.4)] text-[oklch(0.85_0.16_150)]',
  deny: 'bg-[oklch(0.30_0.18_25/0.4)] text-[oklch(0.85_0.18_25)]',
  rejected: 'bg-[oklch(0.30_0.18_60/0.4)] text-[oklch(0.85_0.16_60)]',
} as const;

function Pill({ value, cls }: { value: string; cls: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
    >
      {value}
    </span>
  );
}

/**
 * Counterparty pair derived from the receipts table by matching
 * `(network, tx_sig)`. Either side can be null when only one of the
 * two receipts (earn / spend) has been ingested for a given tx.
 */
export type Counterparties = ReadonlyMap<string, { payer: string | null; receiver: string | null }>;

/**
 * Resolve the (payer, receiver) pair for a given receipt row. We
 * always know the agent on the *receipt side* (earn → receiver,
 * spend → payer); the other side comes from the counterparty map
 * keyed by tx_sig. Falls back to "—" when nothing is known.
 */
function counterpartyFor(
  r: ReceiptRow,
  cp: Counterparties | undefined,
): { payer: string | null; receiver: string | null } {
  const known = r.tx_sig ? cp?.get(r.tx_sig) : undefined;
  if (r.kind === 'earn') {
    return { payer: known?.payer ?? null, receiver: r.agent };
  }
  return { payer: r.agent, receiver: known?.receiver ?? null };
}

export function ReceiptsTable({
  rows,
  network,
  counterparties,
  emptyTitle = 'No receipts yet.',
}: {
  rows: ReceiptRow[];
  network: Network;
  /** Optional `tx_sig → { payer, receiver }` map; when missing the
   * non-receipt side of each row renders as "—". */
  counterparties?: Counterparties;
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
            <th className="px-3 py-2 font-medium">Decision</th>
            <th className="px-3 py-2 font-medium">Payer</th>
            <th className="px-3 py-2 font-medium">Receiver</th>
            <th className="px-3 py-2 font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Fee</th>
            <th className="px-3 py-2 font-medium">Hash</th>
            <th className="px-3 py-2 font-medium text-right">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[--color-border]">
          {rows.map((r) => {
            const { payer, receiver } = counterpartyFor(r, counterparties);
            // Whole-row click target: tx detail when settled, receipt detail otherwise.
            const rowHref = r.tx_sig ? `/tx/${r.tx_sig}` : `/receipt/${r.receipt_hash}`;
            const rowLabel = r.tx_sig
              ? `View transaction ${r.tx_sig}`
              : `View receipt ${r.receipt_hash}`;
            return (
              <tr
                key={r.receipt_hash}
                className="group relative hover:bg-[oklch(0.2_0.02_280/0.6)]"
              >
                <td className="p-0">
                  <Link
                    href={rowHref}
                    aria-label={rowLabel}
                    className="absolute inset-0 z-0"
                    tabIndex={-1}
                  />
                  <div className="relative z-10 px-3 py-2.5 align-middle">
                    <Pill value={r.kind} cls={KIND_CLS[r.kind]} />
                  </div>
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle">
                  <Pill value={r.decision} cls={DECISION_CLS[r.decision]} />
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle">
                  <Mono value={payer} href={payer ? `/agent/${payer}` : undefined} />
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle">
                  <Mono value={receiver} href={receiver ? `/agent/${receiver}` : undefined} />
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle text-xs text-[--color-fg-muted]">
                  {r.price
                    ? formatTokenAmount(
                        r.price.amount,
                        tokenInfoFor(network, r.price.asset ?? null),
                      )
                    : '—'}
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle text-xs text-[--color-fg-muted]">
                  {r.price?.fee
                    ? formatTokenAmount(r.price.fee, tokenInfoFor(network, r.price.asset ?? null), {
                        withUsd: false,
                      })
                    : '—'}
                </td>
                <td className="relative z-10 px-3 py-2.5 align-middle">
                  <Mono value={r.receipt_hash} href={`/receipt/${r.receipt_hash}`} />
                </td>
                <td className="relative z-10 px-3 py-2.5 text-right align-middle text-xs text-[--color-fg-muted]">
                  {formatRelative(r.ts)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

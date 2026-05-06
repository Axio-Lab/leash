import Link from 'next/link';
import { receiptProtocol, settlementTxSig } from '@leashmarket/schemas';
import { cn } from '@/lib/cn';
import type { ReceiptRow } from '@/lib/types';
import type { Network } from '@/lib/network';
import { formatRelative } from '@/lib/format';
import { Mono } from './mono';
import { Empty } from './empty';
import { formatTokenAmount, tokenInfoFor } from '@/lib/token-info';

const KIND_CLS = {
  spend:
    'bg-[oklch(0.32_0.13_320/0.5)] text-[oklch(0.85_0.13_320)] ring-1 ring-inset ring-[oklch(0.5_0.18_320/0.3)]',
  earn: 'bg-[oklch(0.30_0.16_150/0.5)] text-[oklch(0.85_0.16_150)] ring-1 ring-inset ring-[oklch(0.5_0.18_150/0.3)]',
} as const;

const DECISION_CLS = {
  allow:
    'bg-[oklch(0.30_0.16_150/0.4)] text-[oklch(0.85_0.16_150)] ring-1 ring-inset ring-[oklch(0.5_0.18_150/0.25)]',
  deny: 'bg-[oklch(0.30_0.18_25/0.4)] text-[oklch(0.85_0.18_25)] ring-1 ring-inset ring-[oklch(0.5_0.2_25/0.25)]',
  rejected:
    'bg-[oklch(0.30_0.18_60/0.4)] text-[oklch(0.85_0.16_60)] ring-1 ring-inset ring-[oklch(0.5_0.2_60/0.25)]',
} as const;

const PROTOCOL_CLS: Record<'x402' | 'mpp', string> = {
  x402: 'bg-[oklch(0.30_0.12_250/0.45)] text-[oklch(0.88_0.08_250)] ring-1 ring-inset ring-[oklch(0.48_0.14_250/0.35)]',
  mpp: 'bg-[oklch(0.30_0.14_45/0.45)] text-[oklch(0.9_0.12_75)] ring-1 ring-inset ring-[oklch(0.5_0.16_45/0.35)]',
};

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
  const tx = settlementTxSig(r);
  const known = tx ? cp?.get(tx) : undefined;
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
      <Empty
        title={emptyTitle}
        description="Every gated x402 call lands a receipt — they'll surface here as soon as agents transact."
      />
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      {/* Phones see KIND + AMOUNT + HASH + WHEN — the four columns
          a user actually needs to scan a feed. Tablets unlock
          DECISION, payer/receiver, and fee. The full row remains
          tappable, so every collapsed column is still one click
          away on the receipt detail page. */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[--color-border] text-sm">
          <thead className="bg-[--color-bg-elev]/40 text-left text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
            <tr>
              <th className="px-3 py-2.5 font-medium sm:px-4">Kind / rail</th>
              <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Decision</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">Payer</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">Receiver</th>
              <th className="px-3 py-2.5 font-medium">Amount</th>
              <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Fee</th>
              <th className="px-3 py-2.5 font-medium">Hash</th>
              <th className="px-3 py-2.5 text-right font-medium sm:px-4">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-border]/60">
            {rows.map((r, idx) => {
              const { payer, receiver } = counterpartyFor(r, counterparties);
              const txSig = settlementTxSig(r);
              const proto = receiptProtocol(r);
              const rowHref = txSig ? `/tx/${txSig}` : `/receipt/${r.receipt_hash}`;
              const rowLabel = txSig
                ? `View transaction ${txSig}`
                : `View receipt ${r.receipt_hash}`;
              return (
                <tr
                  key={r.receipt_hash}
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
                    <div className="relative z-10 flex flex-wrap items-center gap-1.5 px-3 py-2.5 align-middle sm:px-4">
                      <Pill value={r.kind} cls={KIND_CLS[r.kind]} />
                      <Pill value={proto} cls={PROTOCOL_CLS[proto]} />
                    </div>
                  </td>
                  <td className="relative z-10 hidden px-3 py-2.5 align-middle sm:table-cell">
                    <Pill value={r.decision} cls={DECISION_CLS[r.decision]} />
                  </td>
                  <td className="relative z-10 hidden px-3 py-2.5 align-middle md:table-cell">
                    <Mono value={payer} href={payer ? `/agent/${payer}` : undefined} />
                  </td>
                  <td className="relative z-10 hidden px-3 py-2.5 align-middle md:table-cell">
                    <Mono value={receiver} href={receiver ? `/agent/${receiver}` : undefined} />
                  </td>
                  <td className="relative z-10 px-3 py-2.5 align-middle font-mono text-xs text-[--color-fg]">
                    {r.price
                      ? formatTokenAmount(
                          r.price.amount,
                          tokenInfoFor(network, r.price.asset ?? null),
                        )
                      : '—'}
                  </td>
                  <td className="relative z-10 hidden px-3 py-2.5 align-middle font-mono text-xs text-[--color-fg-muted] lg:table-cell">
                    {r.price?.fee
                      ? formatTokenAmount(
                          r.price.fee,
                          tokenInfoFor(network, r.price.asset ?? null),
                          { withUsd: false },
                        )
                      : '—'}
                  </td>
                  <td className="relative z-10 px-3 py-2.5 align-middle">
                    <Mono value={r.receipt_hash} href={`/receipt/${r.receipt_hash}`} />
                  </td>
                  <td className="relative z-10 px-3 py-2.5 text-right align-middle text-xs text-[--color-fg-muted] sm:px-4">
                    {formatRelative(r.ts)}
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

import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { ReceiptRow } from '@/lib/types';
import type { Network } from '@/lib/network';
import { formatRelative } from '@/lib/format';
import { Mono } from './mono';
import { solscanTxUrl } from '@/lib/solscan';

const KIND_CLS = {
  spend: 'bg-[oklch(0.32_0.13_320_/_0.5)] text-[oklch(0.85_0.13_320)]',
  earn: 'bg-[oklch(0.30_0.16_150_/_0.5)] text-[oklch(0.85_0.16_150)]',
} as const;

const DECISION_CLS = {
  allow: 'bg-[oklch(0.30_0.16_150_/_0.4)] text-[oklch(0.85_0.16_150)]',
  deny: 'bg-[oklch(0.30_0.18_25_/_0.4)] text-[oklch(0.85_0.18_25)]',
  rejected: 'bg-[oklch(0.30_0.18_60_/_0.4)] text-[oklch(0.85_0.16_60)]',
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

export function ReceiptsTable({
  rows,
  network,
  emptyTitle = 'No receipts yet.',
}: {
  rows: ReceiptRow[];
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
            <th className="px-3 py-2 font-medium">Decision</th>
            <th className="px-3 py-2 font-medium">Agent</th>
            <th className="px-3 py-2 font-medium">Price</th>
            <th className="px-3 py-2 font-medium">Tx</th>
            <th className="px-3 py-2 font-medium">Hash</th>
            <th className="px-3 py-2 font-medium text-right">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[--color-border]">
          {rows.map((r) => (
            <tr key={r.receipt_hash} className="hover:bg-[oklch(0.2_0.02_280_/_0.6)]">
              <td className="px-3 py-2.5 align-middle">
                <Pill value={r.kind} cls={KIND_CLS[r.kind]} />
              </td>
              <td className="px-3 py-2.5 align-middle">
                <Pill value={r.decision} cls={DECISION_CLS[r.decision]} />
              </td>
              <td className="px-3 py-2.5 align-middle">
                <Mono value={r.agent} href={`/agent/${r.agent}`} />
              </td>
              <td className="px-3 py-2.5 align-middle text-xs text-[--color-fg-muted]">
                {r.price ? `${r.price.amount} ${r.price.currency}` : '—'}
              </td>
              <td className="px-3 py-2.5 align-middle">
                <Mono
                  value={r.tx_sig ?? null}
                  href={r.tx_sig ? `/tx/${r.tx_sig}` : undefined}
                  external={r.tx_sig ? solscanTxUrl(network, r.tx_sig) : undefined}
                />
              </td>
              <td className="px-3 py-2.5 align-middle">
                <Link
                  href={`/receipt/${r.receipt_hash}`}
                  className="font-mono text-xs text-[--color-brand] hover:text-[--color-brand-strong]"
                  title={r.receipt_hash}
                >
                  {r.receipt_hash.slice(0, 10)}…
                </Link>
              </td>
              <td className="px-3 py-2.5 text-right align-middle text-xs text-[--color-fg-muted]">
                {formatRelative(r.ts)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

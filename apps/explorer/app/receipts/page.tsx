import { DbUnavailableError, listRecentReceipts } from '@/lib/db';
import type { ReceiptPage } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { ReceiptsTable } from '@/components/receipts-table';
import { DbUnreachable } from '@/components/empty';

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
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
          {networkToSlug(network)} · receipts
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Receipt feed</h1>
        <p className="max-w-2xl text-sm text-[--color-fg-muted]">
          Every x402 settlement that any agent has emitted. Earn receipts come from paywall-served
          calls; spend receipts come from buyer-side payments.
        </p>
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

      {res.ok ? (
        <>
          <ReceiptsTable rows={res.data.items} network={network} />
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { apiFetch, type ReceiptRow } from '@/lib/api';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { ApiUnreachable } from '@/components/empty';
import { Mono } from '@/components/mono';
import { solscanTxUrl } from '@/lib/solscan';
import { formatTs, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ hash: string }> };

type ByHashResponse = ReceiptRow | { receipt: ReceiptRow; network?: string };

export default async function ReceiptPage({ params }: Props) {
  const { hash } = await params;
  const network = await getNetwork();

  const res = await apiFetch<ByHashResponse>(
    network,
    `/v1/receipts/by-hash/${encodeURIComponent(hash)}`,
  );
  if (!res.ok) {
    if (res.code === 'not_found') notFound();
    return <ApiUnreachable network={network} message={res.message} />;
  }

  const r =
    typeof (res.data as { receipt?: unknown }).receipt === 'object'
      ? (res.data as { receipt: ReceiptRow }).receipt
      : (res.data as ReceiptRow);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
          Receipt · {networkToSlug(network)}
        </p>
        <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{hash}</h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[--color-fg-muted]">
          <span className="rounded-md bg-[--color-bg-elev] px-2 py-0.5 uppercase tracking-wider">
            {r.kind}
          </span>
          <span className="rounded-md bg-[--color-bg-elev] px-2 py-0.5 uppercase tracking-wider">
            {r.decision}
          </span>
          <span>nonce {r.nonce}</span>
          <span>·</span>
          <span>
            {formatTs(r.ts)} · {formatRelative(r.ts)}
          </span>
        </div>
      </header>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold">Summary</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <Field label="Agent">
            <Mono value={r.agent} href={`/agent/${r.agent}`} />
          </Field>
          {r.tx_sig ? (
            <Field label="Tx signature">
              <Mono
                value={r.tx_sig}
                href={`/tx/${r.tx_sig}`}
                external={solscanTxUrl(network, r.tx_sig)}
              />
            </Field>
          ) : null}
          {r.price ? <Field label="Price">{`${r.price.amount} ${r.price.currency}`}</Field> : null}
          {r.reason ? <Field label="Reason">{r.reason}</Field> : null}
          <Field label="Request hash">{r.request_hash}</Field>
          {r.payment_requirements_hash ? (
            <Field label="Payment requirements">{r.payment_requirements_hash}</Field>
          ) : null}
          <Field label="Prev receipt">
            {r.prev_receipt_hash ? (
              <Link
                href={`/receipt/${r.prev_receipt_hash}`}
                className="text-[--color-brand] hover:text-[--color-brand-strong]"
                title={r.prev_receipt_hash}
              >
                {r.prev_receipt_hash.slice(0, 12)}…
              </Link>
            ) : (
              <span className="text-[--color-fg-subtle]">genesis</span>
            )}
          </Field>
        </dl>
      </section>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold">Raw JSON</h2>
        <pre className="overflow-x-auto rounded-md bg-[oklch(0.18_0.02_280)] p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(r, null, 2)}
        </pre>
      </section>

      {r.tx_sig ? (
        <a
          href={solscanTxUrl(network, r.tx_sig)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs text-[--color-brand] hover:text-[--color-brand-strong]"
        >
          View settlement on Solscan <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-28 shrink-0 text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
        {label}
      </dt>
      <dd className="font-mono text-xs text-[--color-fg]">{children}</dd>
    </div>
  );
}

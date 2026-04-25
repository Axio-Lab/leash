import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { DbUnavailableError, getReceiptByHash } from '@/lib/db';
import { probeReceiptOnOtherNetwork } from '@/lib/cross-network';
import type { ReceiptRow } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug, type Network } from '@/lib/network';
import { DbUnreachable } from '@/components/empty';
import { Mono } from '@/components/mono';
import { NoRecordFound, WrongNetworkNotice } from '@/components/wrong-network-notice';
import { solscanTxUrl } from '@/lib/solscan';
import { formatTs, formatRelative } from '@/lib/format';
import { formatAtomicAsUi, formatTokenAmount, tokenInfoFor } from '@/lib/token-info';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ hash: string }> };

export default async function ReceiptPage({ params }: Props) {
  const { hash } = await params;
  const network = await getNetwork();

  let r: ReceiptRow | null;
  try {
    r = await getReceiptByHash(network, hash);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return <DbUnreachable network={network} message={err.message} />;
    }
    throw err;
  }
  if (!r) {
    const probe = await probeReceiptOnOtherNetwork(network, hash);
    return (
      <NotFoundShell title="Receipt" network={network} identifier={hash}>
        {probe.foundOnOther ? (
          <WrongNetworkNotice
            current={probe.current}
            other={probe.other}
            entity="receipt"
            identifier={hash}
          />
        ) : (
          <NoRecordFound entity="receipt" identifier={hash} network={network} />
        )}
      </NotFoundShell>
    );
  }

  const displayJson = toDisplayReceiptJson(r, network);

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
          {r.price ? (
            <Field label="Price" hint={`Raw on-chain integer (atoms): ${r.price.amount}`}>
              {formatTokenAmount(r.price.amount, tokenInfoFor(network, r.price.asset ?? null))}
            </Field>
          ) : null}
          {r.reason ? <Field label="Reason">{r.reason}</Field> : null}
          <Field label="Request">
            <span className="break-all">
              {r.request.method} {r.request.url}
            </span>
          </Field>
          {r.request.body_hash ? <Field label="Request body">{r.request.body_hash}</Field> : null}
          {r.response ? (
            <Field label="Response">
              {r.response.status}
              {r.response.body_hash ? ` · ${r.response.body_hash.slice(0, 12)}…` : ''}
            </Field>
          ) : null}
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
          {JSON.stringify(displayJson, null, 2)}
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

function toDisplayReceiptJson(r: ReceiptRow, network: Network): Record<string, unknown> {
  if (!r.price) return r as unknown as Record<string, unknown>;
  const info = tokenInfoFor(network, r.price.asset ?? null);
  const normalizedAmount = formatAtomicAsUi(r.price.amount, info.decimals);
  return {
    ...r,
    price: {
      ...r.price,
      amount: normalizedAmount,
      amount_atomic: r.price.amount,
    },
  } as unknown as Record<string, unknown>;
}

function NotFoundShell({
  title,
  network,
  identifier,
  children,
}: {
  title: string;
  network: Network;
  identifier: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
          {title} · {networkToSlug(network)}
        </p>
        <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{identifier}</h1>
      </header>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt
        className="w-28 shrink-0 text-[10px] uppercase tracking-wider text-[--color-fg-subtle]"
        title={hint}
      >
        {label}
        {hint ? <span className="ml-1 cursor-help text-[--color-fg-muted]">ⓘ</span> : null}
      </dt>
      <dd className="font-mono text-xs text-[--color-fg]">{children}</dd>
    </div>
  );
}

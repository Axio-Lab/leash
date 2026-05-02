import Link from 'next/link';
import { ArrowLeft, ExternalLink, Layers } from 'lucide-react';
import { DbUnavailableError, listEventsForSignature } from '@/lib/db';
import { probeTxOnOtherNetwork } from '@/lib/cross-network';
import type { EventRow } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug, type Network } from '@/lib/network';
import { describeEvent } from '@/lib/event-label';
import { EventBadge, PhaseBadge } from '@/components/event-badge';
import { DbUnreachable } from '@/components/empty';
import { Mono } from '@/components/mono';
import { NoRecordFound, WrongNetworkNotice } from '@/components/wrong-network-notice';
import { solscanTxUrl, solscanAddrUrl } from '@/lib/solscan';
import { formatTs, formatRelative } from '@/lib/format';
import { formatTokenAmount, tokenInfoFor } from '@/lib/token-info';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ sig: string }> };

export default async function TxPage({ params }: Props) {
  const { sig } = await params;
  const network = await getNetwork();

  let matches: EventRow[];
  try {
    matches = await listEventsForSignature(network, sig);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return <DbUnreachable network={network} message={err.message} />;
    }
    throw err;
  }

  if (matches.length === 0) {
    const probe = await probeTxOnOtherNetwork(network, sig);
    return (
      <NotFoundShell title="Transaction" network={network} sig={sig}>
        {probe.foundOnOther ? (
          <WrongNetworkNotice
            current={probe.current}
            other={probe.other}
            entity="transaction"
            identifier={sig}
          />
        ) : (
          <NoRecordFound entity="transaction" identifier={sig} network={network} />
        )}
      </NotFoundShell>
    );
  }

  const head = matches[0]!;

  return (
    <div className="space-y-8">
      <header className="card-glow space-y-4 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <Layers className="h-3 w-3 text-[--color-brand]" />
            Transaction · {networkToSlug(network)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PhaseBadge phase={head.phase} />
          <span className="text-xs text-[--color-fg-muted]">
            {formatTs(head.ts)} · {formatRelative(head.ts)}
          </span>
          <a
            href={solscanTxUrl(network, sig)}
            target="_blank"
            rel="noreferrer noopener"
            className="group ml-auto inline-flex items-center gap-1 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-xs text-[--color-brand-strong] backdrop-blur-md transition-all hover:border-[--color-brand-strong] hover:text-[--color-brand]"
          >
            View on Solscan
            <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
        <h1 className="break-all font-mono text-xl tracking-tight text-[--color-fg] sm:text-2xl">
          {sig}
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Decoded events{' '}
          <span className="ml-1 rounded-full bg-[--color-brand-soft]/40 px-2 py-0.5 text-xs font-normal text-[--color-fg-muted]">
            {matches.length}
          </span>
        </h2>
        <div className="space-y-3">
          {matches.map((row, idx) => (
            <DecodedRow key={row.id} row={row} network={network} idx={idx} />
          ))}
        </div>
      </section>

      <Link
        href="/events"
        className="group inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1.5 text-xs text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:text-[--color-fg]"
      >
        <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
        Back to events
      </Link>
    </div>
  );
}

function NotFoundShell({
  title,
  network,
  sig,
  children,
}: {
  title: string;
  network: Network;
  sig: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
          {title} · {networkToSlug(network)}
        </p>
        <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{sig}</h1>
        <a
          href={solscanTxUrl(network, sig)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs text-[--color-brand] hover:text-[--color-brand-strong]"
        >
          View on Solscan <ExternalLink className="h-3 w-3" />
        </a>
      </header>
      {children}
    </div>
  );
}

function DecodedRow({ row, network, idx }: { row: EventRow; network: Network; idx: number }) {
  const desc = describeEvent(row);
  return (
    <div
      className="card motion-safe:[animation:var(--animate-row-in)] px-5 py-4 transition-all hover:border-[--color-brand-soft]/60 hover:bg-[--color-brand-soft]/5"
      style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
    >
      <div className="flex items-center gap-2">
        <EventBadge descriptor={desc} />
        <span className="text-sm font-medium">{desc.label}</span>
        <Link
          href={`/event/${row.id}`}
          className="ml-auto text-xs text-[--color-fg-muted] transition-colors hover:text-[--color-fg]"
        >
          event {row.id.slice(-6)} →
        </Link>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[--color-fg-muted]">
        {desc.description(row)}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
        {row.agent_asset ? (
          <Field label="Agent">
            <Mono value={row.agent_asset} href={`/agent/${row.agent_asset}`} />
          </Field>
        ) : null}
        {row.mint ? (
          <Field label="Mint">
            <Mono value={row.mint} external={solscanAddrUrl(network, row.mint)} />
          </Field>
        ) : null}
        {row.amount_atomic ? (
          <Field label="Amount" hint={`Raw on-chain integer (atoms): ${row.amount_atomic}`}>
            {formatTokenAmount(row.amount_atomic, tokenInfoFor(network, row.mint))}
          </Field>
        ) : null}
        {row.client_reference ? <Field label="Client ref">{row.client_reference}</Field> : null}
        {row.error_code ? <Field label="Error">{row.error_code}</Field> : null}
      </dl>
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
    <div className="flex items-center gap-3">
      <dt
        className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-[--color-fg-subtle]"
        title={hint}
      >
        {label}
        {hint ? <span className="ml-1 cursor-help text-[--color-fg-muted]">ⓘ</span> : null}
      </dt>
      <dd className="font-mono text-xs text-[--color-fg]">{children}</dd>
    </div>
  );
}

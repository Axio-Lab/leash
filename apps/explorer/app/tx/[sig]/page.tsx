import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
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
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
          Transaction · {networkToSlug(network)}
        </p>
        <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{sig}</h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[--color-fg-muted]">
          <PhaseBadge phase={head.phase} />
          <span>{formatTs(head.ts)}</span>
          <span>·</span>
          <span>{formatRelative(head.ts)}</span>
          <a
            href={solscanTxUrl(network, sig)}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1 text-[--color-brand] hover:text-[--color-brand-strong]"
          >
            View on Solscan <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Decoded events ({matches.length})</h2>
        <div className="space-y-3">
          {matches.map((row) => (
            <DecodedRow key={row.id} row={row} network={network} />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Header + container shared between the "real" tx view and the
 * not-found / wrong-network states. Keeps Solscan link and identifier
 * visible so the user can verify the cluster they need.
 */
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
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
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

function DecodedRow({ row, network }: { row: EventRow; network: Network }) {
  const desc = describeEvent(row);
  return (
    <div className="card px-5 py-4">
      <div className="flex items-center gap-2">
        <EventBadge descriptor={desc} />
        <span className="text-sm font-medium">{desc.label}</span>
        <Link
          href={`/event/${row.id}`}
          className="ml-auto text-xs text-[--color-fg-muted] hover:text-[--color-fg]"
        >
          event {row.id.slice(-6)} →
        </Link>
      </div>
      <p className="mt-2 text-sm text-[--color-fg-muted]">{desc.description(row)}</p>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
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

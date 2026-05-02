import Link from 'next/link';
import { ArrowLeft, ExternalLink, Activity } from 'lucide-react';
import { DbUnavailableError, getEventById } from '@/lib/db';
import { probeEventOnOtherNetwork } from '@/lib/cross-network';
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
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function EventPage({ params }: Props) {
  const { id } = await params;
  const network = await getNetwork();

  let row: EventRow | null;
  try {
    row = await getEventById(network, id);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return <DbUnreachable network={network} message={err.message} />;
    }
    throw err;
  }
  if (!row) {
    const probe = await probeEventOnOtherNetwork(network, id);
    return (
      <NotFoundShell title="Event" network={network} identifier={id}>
        {probe.foundOnOther ? (
          <WrongNetworkNotice
            current={probe.current}
            other={probe.other}
            entity="event"
            identifier={id}
          />
        ) : (
          <NoRecordFound entity="event" identifier={id} network={network} />
        )}
      </NotFoundShell>
    );
  }

  const desc = describeEvent(row);

  return (
    <div className="space-y-8">
      <header className="card-glow space-y-4 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <Activity className="h-3 w-3 text-[--color-brand]" />
            Event · {networkToSlug(network)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EventBadge descriptor={desc} />
          <PhaseBadge phase={row.phase} />
          <span className="text-xs text-[--color-fg-muted]">
            {formatTs(row.ts)} · {formatRelative(row.ts)}
          </span>
        </div>
        <h1 className="break-all font-mono text-xl tracking-tight text-[--color-fg] sm:text-2xl">
          {id}
        </h1>
        <p className="text-sm leading-relaxed text-[--color-fg-muted]">{desc.description(row)}</p>
      </header>

      <section className="card px-5 py-4 sm:px-6 sm:py-5">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">Lifecycle</h2>
        <Timeline row={row} />
      </section>

      <section className="card px-5 py-4 sm:px-6 sm:py-5">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">Details</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-xs sm:grid-cols-2">
          <Field label="Kind">{row.kind}</Field>
          <Field
            label="Status"
            hint="prepared = built but not yet broadcast · submitted = sent to validator · confirmed = on-chain · failed = reverted"
          >
            {row.phase}
          </Field>
          {row.agent_asset ? (
            <Field label="Agent">
              <Mono value={row.agent_asset} href={`/agent/${row.agent_asset}`} />
            </Field>
          ) : null}
          {row.signature ? (
            <Field label="Signature">
              <Mono
                value={row.signature}
                href={`/tx/${row.signature}`}
                external={solscanTxUrl(network, row.signature)}
              />
            </Field>
          ) : null}
          {row.mint ? (
            <Field label="Mint">
              <Mono value={row.mint} external={solscanAddrUrl(network, row.mint)} />
            </Field>
          ) : null}
          {row.amount_atomic ? (
            <Field
              label="Amount"
              hint={`Raw on-chain integer (atoms): ${row.amount_atomic}. Human value uses the mint's decimals.`}
            >
              <span className="font-mono text-sm text-[--color-fg]">
                {formatTokenAmount(row.amount_atomic, tokenInfoFor(network, row.mint))}
              </span>
            </Field>
          ) : null}
          {row.client_reference ? <Field label="Client ref">{row.client_reference}</Field> : null}
          {row.error_code ? <Field label="Error">{row.error_code}</Field> : null}
          {row.error_message ? <Field label="Error message">{row.error_message}</Field> : null}
        </dl>
      </section>

      {Object.keys(row.metadata ?? {}).length > 0 ? (
        <section className="card px-5 py-4 sm:px-6 sm:py-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Metadata</h2>
          <pre className="overflow-x-auto rounded-lg border border-[--color-border] bg-[--color-bg]/60 p-4 font-mono text-[11px] leading-relaxed text-[--color-fg]">
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/events"
          className="group inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1.5 text-xs text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:text-[--color-fg]"
        >
          <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
          Back to events
        </Link>
        {row.signature ? (
          <Link
            href={`/tx/${row.signature}`}
            className="group inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-brand-soft]/40 px-3 py-1.5 text-xs text-[--color-fg] backdrop-blur-md transition-all hover:border-[--color-brand-strong] hover:bg-[--color-brand-soft]"
          >
            See full transaction
            <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Vertical timeline: prepared → submitted → confirmed (or → failed).
 * Brighter rail segments connect "reached" steps; the active step gets
 * a pulsing dot to anchor the user's eye.
 */
function Timeline({ row }: { row: EventRow }) {
  const phases = (
    [
      { key: 'prepared', label: 'Prepared', ts: row.ts },
      { key: 'submitted', label: 'Submitted', ts: row.signature ? row.ts : null },
      { key: 'confirmed', label: 'Confirmed', ts: row.confirmed_at },
      { key: 'failed', label: 'Failed', ts: row.failed_at },
    ] as const
  ).filter((p) => (p.key === 'failed' ? row.failed_at != null : true));

  return (
    <ol className="relative space-y-3">
      {phases.map((p, idx) => {
        const isCurrent = p.key === row.phase;
        const reached =
          row.phase === 'failed'
            ? p.key !== 'confirmed' || false
            : ['prepared', 'submitted', 'confirmed'].indexOf(p.key) <=
              ['prepared', 'submitted', 'confirmed'].indexOf(row.phase as 'prepared');
        return (
          <li
            key={p.key}
            className={cn(
              'relative flex items-center gap-3 rounded-lg border border-[--color-border] bg-[--color-bg-elev-2]/40 px-3 py-2.5 backdrop-blur-md transition-colors',
              isCurrent && 'border-[--color-brand-soft]/70 bg-[--color-brand-soft]/15',
            )}
          >
            <span className="relative inline-flex h-2 w-2 shrink-0 items-center justify-center">
              <span
                className={cn(
                  'inline-block h-2 w-2 rounded-full',
                  isCurrent
                    ? p.key === 'failed'
                      ? 'bg-[--color-danger] shadow-[0_0_8px_oklch(0.7_0.22_25/0.6)]'
                      : 'bg-[--color-brand] shadow-[0_0_8px_oklch(0.66_0.19_268/0.6)]'
                    : reached
                      ? 'bg-[--color-success]'
                      : 'bg-[--color-border-strong]',
                )}
              />
              {isCurrent ? (
                <span
                  className={cn(
                    'absolute inset-0 inline-block h-2 w-2 rounded-full opacity-50 motion-safe:animate-ping',
                    p.key === 'failed' ? 'bg-[--color-danger]' : 'bg-[--color-brand]',
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </span>
            <span className="text-xs font-medium text-[--color-fg]">{p.label}</span>
            <span className="ml-auto font-mono text-[11px] text-[--color-fg-muted]">
              {p.ts ? formatTs(p.ts) : '—'}
            </span>
            {idx < phases.length - 1 ? (
              <span
                className={cn(
                  'absolute left-[1.625rem] top-full block h-3 w-px',
                  reached
                    ? 'bg-gradient-to-b from-[--color-success]/60 to-transparent'
                    : 'bg-[--color-border]',
                )}
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
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
        <p className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
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
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
      <dt
        className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle] sm:w-32 sm:shrink-0"
        title={hint}
      >
        {label}
        {hint ? <span className="ml-1 cursor-help text-[--color-fg-muted]">ⓘ</span> : null}
      </dt>
      <dd className="min-w-0 break-all font-mono text-xs text-[--color-fg]">{children}</dd>
    </div>
  );
}

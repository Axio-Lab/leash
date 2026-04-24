import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { DbUnavailableError, getEventById } from '@/lib/db';
import type { EventRow } from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { describeEvent } from '@/lib/event-label';
import { EventBadge, PhaseBadge } from '@/components/event-badge';
import { DbUnreachable } from '@/components/empty';
import { Mono } from '@/components/mono';
import { solscanTxUrl, solscanAddrUrl } from '@/lib/solscan';
import { formatTs, formatRelative } from '@/lib/format';

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
  if (!row) notFound();

  const desc = describeEvent(row);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
          Event · {networkToSlug(network)}
        </p>
        <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{id}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <EventBadge descriptor={desc} />
          <PhaseBadge phase={row.phase} />
          <span className="text-xs text-[--color-fg-muted]">
            {formatTs(row.ts)} · {formatRelative(row.ts)}
          </span>
        </div>
        <p className="text-sm text-[--color-fg-muted]">{desc.description(row)}</p>
      </header>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold">Lifecycle</h2>
        <Timeline row={row} />
      </section>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold">Details</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <Field label="Kind">{row.kind}</Field>
          <Field label="Phase">{row.phase}</Field>
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
          {row.amount_atomic ? <Field label="Amount (atomic)">{row.amount_atomic}</Field> : null}
          {row.client_reference ? <Field label="Client ref">{row.client_reference}</Field> : null}
          {row.error_code ? <Field label="Error">{row.error_code}</Field> : null}
          {row.error_message ? <Field label="Error message">{row.error_message}</Field> : null}
        </dl>
      </section>

      {Object.keys(row.metadata ?? {}).length > 0 ? (
        <section className="card px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold">Metadata</h2>
          <pre className="overflow-x-auto rounded-md bg-[oklch(0.18_0.02_280)] p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        </section>
      ) : null}

      {row.signature ? (
        <Link
          href={`/tx/${row.signature}`}
          className="inline-flex items-center gap-1 text-xs text-[--color-brand] hover:text-[--color-brand-strong]"
        >
          See full transaction <ExternalLink className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

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
    <ol className="space-y-2">
      {phases.map((p) => {
        const isCurrent = p.key === row.phase;
        const reached =
          row.phase === 'failed'
            ? p.key !== 'confirmed' || false
            : ['prepared', 'submitted', 'confirmed'].indexOf(p.key) <=
              ['prepared', 'submitted', 'confirmed'].indexOf(row.phase as 'prepared');
        return (
          <li key={p.key} className="flex items-center gap-3 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isCurrent
                  ? 'bg-[--color-brand]'
                  : reached
                    ? 'bg-[--color-success]'
                    : 'bg-[--color-border-strong]'
              }`}
            />
            <span className="font-medium text-[--color-fg]">{p.label}</span>
            <span className="ml-auto text-[--color-fg-muted]">{p.ts ? formatTs(p.ts) : '—'}</span>
          </li>
        );
      })}
    </ol>
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

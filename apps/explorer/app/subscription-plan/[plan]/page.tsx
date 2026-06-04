import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarClock, ExternalLink, FileJson, Repeat2 } from 'lucide-react';
import {
  DbUnavailableError,
  getNativeSubscriptionPlan,
  listNativeSubscriptionEvents,
} from '@/lib/db';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug, type Network } from '@/lib/network';
import { formatRelative, formatTs } from '@/lib/format';
import { formatTokenAmount, tokenInfoFor } from '@/lib/token-info';
import { solscanAddrUrl, solscanTxUrl } from '@/lib/solscan';
import { DbUnreachable } from '@/components/empty';
import { EventBadge, PhaseBadge } from '@/components/event-badge';
import { Mono } from '@/components/mono';
import { describeEvent } from '@/lib/event-label';
import type { EventRow, NativeSubscriptionPlan } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ plan: string }> };

export default async function SubscriptionPlanPage({ params }: Props) {
  const { plan } = await params;
  const network = await getNetwork();

  let data: NativeSubscriptionPlan | null;
  let events: EventRow[];
  try {
    [data, events] = await Promise.all([
      getNativeSubscriptionPlan(network, plan),
      listNativeSubscriptionEvents({ network, plan, limit: 25 }),
    ]);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return <DbUnreachable network={network} message={err.message} />;
    }
    throw err;
  }

  if (!data) notFound();

  const metadata = data.metadata;
  const title = stringField(metadata.name) ?? `Plan ${data.plan_id}`;
  const description = stringField(metadata.description);
  const termsUrl = stringField(metadata.terms_url);
  const supportUrl = stringField(metadata.support_url);

  return (
    <div className="space-y-8">
      <header className="card-glow space-y-4 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <Repeat2 className="h-3 w-3 text-[--color-brand]" />
            Native subscription plan · {networkToSlug(network)}
          </span>
          <span className="rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-xs capitalize text-[--color-fg-muted]">
            {data.status}
          </span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-[--color-fg] sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm leading-relaxed text-[--color-fg-muted]">
              {description}
            </p>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric
            label="Price"
            value={formatTokenAmount(data.amount_atomic, tokenInfoFor(network, data.mint))}
          />
          <Metric label="Period" value={periodLabel(data.period_hours)} />
          <Metric label="Plan ID" value={data.plan_id} mono />
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs lg:grid-cols-2">
          <Field label="Plan PDA">
            <Mono value={data.plan} external={solscanAddrUrl(network, data.plan)} />
          </Field>
          <Field label="Merchant agent">
            <Mono value={data.agent_mint} href={`/agent/${data.agent_mint}`} />
          </Field>
          <Field label="Merchant wallet">
            <Mono
              value={data.merchant_wallet}
              external={solscanAddrUrl(network, data.merchant_wallet)}
            />
          </Field>
          <Field label="Mint">
            <Mono value={data.mint} external={solscanAddrUrl(network, data.mint)} />
          </Field>
        </dl>
        <div className="flex flex-wrap gap-2">
          <ExternalPill
            href={data.metadata_uri}
            label="Metadata JSON"
            icon={<FileJson className="h-3 w-3" />}
          />
          {data.create_tx_sig ? (
            <ExternalPill
              href={solscanTxUrl(network, data.create_tx_sig)}
              label="Create tx"
              icon={<ExternalLink className="h-3 w-3" />}
            />
          ) : null}
          {termsUrl ? (
            <ExternalPill
              href={termsUrl}
              label="Terms"
              icon={<ExternalLink className="h-3 w-3" />}
            />
          ) : null}
          {supportUrl ? (
            <ExternalPill
              href={supportUrl}
              label="Support"
              icon={<ExternalLink className="h-3 w-3" />}
            />
          ) : null}
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CalendarClock className="h-4 w-4 text-[--color-brand]" />
          Plan timeline
        </h2>
        {events.length > 0 ? (
          <div className="space-y-3">
            {events.map((event, idx) => (
              <TimelineRow key={event.id} row={event} idx={idx} network={network} />
            ))}
          </div>
        ) : (
          <div className="card px-5 py-5 text-sm text-[--color-fg-muted]">
            No Leash-native events have been indexed for this plan yet.
          </div>
        )}
      </section>

      <Link
        href="/events"
        className="group inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1.5 text-xs text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:text-[--color-fg]"
      >
        <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
        Back to events
      </Link>
    </div>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[--color-fg-subtle]">{label}</p>
      <p
        className={
          mono ? 'mt-1 font-mono text-sm text-[--color-fg]' : 'mt-1 text-sm text-[--color-fg]'
        }
      >
        {value}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <dt className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle] sm:w-32 sm:shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 break-all font-mono text-xs text-[--color-fg]">{children}</dd>
    </div>
  );
}

function ExternalPill({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactElement;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1.5 text-xs text-[--color-brand-strong] transition-colors hover:border-[--color-brand-strong] hover:text-[--color-brand]"
    >
      {icon}
      {label}
    </a>
  );
}

function TimelineRow({ row, network, idx }: { row: EventRow; network: Network; idx: number }) {
  const desc = describeEvent(row);
  return (
    <div
      className="card motion-safe:[animation:var(--animate-row-in)] px-5 py-4"
      style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <EventBadge descriptor={desc} />
        <span className="text-sm font-medium">{desc.label}</span>
        <PhaseBadge phase={row.phase} />
        <span className="ml-auto text-xs text-[--color-fg-muted]">
          {formatTs(row.ts)} · {formatRelative(row.ts)}
        </span>
      </div>
      <p className="mt-2 text-sm text-[--color-fg-muted]">{desc.description(row)}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <Mono value={row.signature} href={row.signature ? `/tx/${row.signature}` : undefined} />
        {row.signature ? (
          <a
            href={solscanTxUrl(network, row.signature)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[--color-brand] hover:text-[--color-brand-strong]"
          >
            Solscan <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function periodLabel(hours: string): string {
  const n = Number(hours);
  if (Number.isFinite(n) && n % 24 === 0) {
    const days = n / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${hours} hours`;
}

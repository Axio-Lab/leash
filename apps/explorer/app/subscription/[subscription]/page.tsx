import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Repeat2, UserCheck } from 'lucide-react';
import {
  DbUnavailableError,
  getNativeSubscription,
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
import type { EventRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ subscription: string }> };

export default async function SubscriptionPage({ params }: Props) {
  const { subscription } = await params;
  const network = await getNetwork();

  let data;
  let plan;
  let events: EventRow[];
  try {
    data = await getNativeSubscription(network, subscription);
    plan = data ? await getNativeSubscriptionPlan(network, data.plan) : null;
    events = await listNativeSubscriptionEvents({ network, subscription, limit: 25 });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return <DbUnreachable network={network} message={err.message} />;
    }
    throw err;
  }

  if (!data) notFound();

  const title =
    plan && typeof plan.metadata.name === 'string' ? plan.metadata.name : 'Native subscription';

  return (
    <div className="space-y-8">
      <header className="card-glow space-y-4 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <UserCheck className="h-3 w-3 text-[--color-brand]" />
            Native subscription · {networkToSlug(network)}
          </span>
          <span className="rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-xs capitalize text-[--color-fg-muted]">
            {data.status}
          </span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-[--color-fg] sm:text-3xl">
            {title}
          </h1>
          {plan ? (
            <p className="max-w-2xl text-sm text-[--color-fg-muted]">
              {formatTokenAmount(plan.amount_atomic, tokenInfoFor(network, plan.mint))} every{' '}
              {periodLabel(plan.period_hours)}
            </p>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs lg:grid-cols-2">
          <Field label="Subscription PDA">
            <Mono value={data.subscription} external={solscanAddrUrl(network, data.subscription)} />
          </Field>
          <Field label="Plan">
            <Mono value={data.plan} href={`/subscription-plan/${data.plan}`} />
          </Field>
          <Field label="Subscriber">
            <Mono
              value={data.subscriber_wallet}
              external={solscanAddrUrl(network, data.subscriber_wallet)}
            />
          </Field>
          <Field label="Merchant agent">
            <Mono value={data.agent_mint} href={`/agent/${data.agent_mint}`} />
          </Field>
          {data.mint ? (
            <Field label="Mint">
              <Mono value={data.mint} external={solscanAddrUrl(network, data.mint)} />
            </Field>
          ) : null}
        </dl>
        <div className="flex flex-wrap gap-2">
          {data.subscribe_tx_sig ? (
            <ExternalPill
              href={solscanTxUrl(network, data.subscribe_tx_sig)}
              label="Subscribe tx"
            />
          ) : null}
          {data.last_tx_sig && data.last_tx_sig !== data.subscribe_tx_sig ? (
            <ExternalPill href={solscanTxUrl(network, data.last_tx_sig)} label="Latest tx" />
          ) : null}
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Repeat2 className="h-4 w-4 text-[--color-brand]" />
          Subscription timeline
        </h2>
        {events.length > 0 ? (
          <div className="space-y-3">
            {events.map((event, idx) => (
              <TimelineRow key={event.id} row={event} idx={idx} network={network} />
            ))}
          </div>
        ) : (
          <div className="card px-5 py-5 text-sm text-[--color-fg-muted]">
            No Leash-native events have been indexed for this subscription yet.
          </div>
        )}
      </section>

      <Link
        href={plan ? `/subscription-plan/${plan.plan}` : '/events'}
        className="group inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1.5 text-xs text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:text-[--color-fg]"
      >
        <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
        Back to plan
      </Link>
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

function ExternalPill({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1.5 text-xs text-[--color-brand-strong] transition-colors hover:border-[--color-brand-strong] hover:text-[--color-brand]"
    >
      <ExternalLink className="h-3 w-3" />
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

function periodLabel(hours: string): string {
  const n = Number(hours);
  if (Number.isFinite(n) && n % 24 === 0) {
    const days = n / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${hours} hours`;
}

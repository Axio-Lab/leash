import Link from 'next/link';
import { receiptProtocol, settlementTxSig } from '@leashmarket/schemas';
import { ArrowLeft, ArrowRight, ExternalLink, Hash, Link as LinkIcon } from 'lucide-react';
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
import { cn } from '@/lib/cn';

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
  const txSig = settlementTxSig(r);
  const proto = receiptProtocol(r);

  return (
    <div className="space-y-8">
      {/* Hero header — frosted glass with the hash treated as the focal
          identifier. Pills surface kind/decision/nonce inline, so the
          row reads like a status line in an explorer like solscan. */}
      <header className="card-glow space-y-4 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <Hash className="h-3 w-3 text-[--color-brand]" />
            Proof receipt · {networkToSlug(network)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <KindPill value={r.kind} />
          <ProtocolPill value={proto} />
          <DecisionPill value={r.decision} />
          <span className="rounded-md border border-[--color-border] bg-[--color-bg-elev]/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[--color-fg-muted] backdrop-blur-md">
            nonce {r.nonce}
          </span>
          <span className="text-xs text-[--color-fg-muted]">
            {formatTs(r.ts)} · {formatRelative(r.ts)}
          </span>
        </div>
        <h1 className="break-all font-mono text-xl tracking-tight text-[--color-fg] sm:text-2xl">
          {hash}
        </h1>
      </header>

      <section className="card px-5 py-4 sm:px-6 sm:py-5">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">Summary</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-xs sm:grid-cols-2">
          <Field label="Agent">
            <Mono value={r.agent} href={`/agent/${r.agent}`} />
          </Field>
          {txSig ? (
            <Field label="Tx signature">
              <Mono value={txSig} href={`/tx/${txSig}`} external={solscanTxUrl(network, txSig)} />
            </Field>
          ) : null}
          {r.price ? (
            <Field label="Amount" hint={`Raw on-chain integer (atoms): ${r.price.amount}`}>
              <span className="font-mono text-sm text-[--color-fg]">
                {formatTokenAmount(r.price.amount, tokenInfoFor(network, r.price.asset ?? null))}
              </span>
            </Field>
          ) : null}
          {r.price?.fee ? (
            <Field
              label="Protocol fee"
              hint={`Leash protocol fee in atoms: ${r.price.fee}${
                typeof r.price.feeBps === 'number' ? ` (${r.price.feeBps} bps)` : ''
              }`}
            >
              {formatTokenAmount(r.price.fee, tokenInfoFor(network, r.price.asset ?? null), {
                withUsd: false,
              })}
            </Field>
          ) : null}
          {r.price?.feeAuthority ? (
            <Field label="Fee authority" hint="Treasury wallet that received the protocol fee">
              <Mono value={r.price.feeAuthority} />
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
        </dl>
      </section>

      {/* Hash-chain visualisation: receipts are a JSONL-style chained
          log, so showing prev → current as a directional timeline lets
          users mentally place this receipt in its agent's history. */}
      <section className="card px-5 py-4 sm:px-6 sm:py-5">
        <h2 className="mb-4 inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[--color-brand-soft]/40 text-[--color-brand-strong] ring-1 ring-inset ring-[--color-brand-soft]">
            <LinkIcon className="h-3 w-3" />
          </span>
          Hash chain
        </h2>
        <ChainStep
          label="Previous receipt"
          value={r.prev_receipt_hash}
          href={r.prev_receipt_hash ? `/receipt/${r.prev_receipt_hash}` : undefined}
        />
        <div className="my-1 ml-2 h-4 w-px bg-gradient-to-b from-[--color-brand-soft] to-transparent" />
        <ChainStep label="This receipt" value={r.receipt_hash} active />
      </section>

      <section className="card px-5 py-4 sm:px-6 sm:py-5">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Raw JSON</h2>
        <pre className="overflow-x-auto rounded-lg border border-[--color-border] bg-[--color-bg]/60 p-4 font-mono text-[11px] leading-relaxed text-[--color-fg]">
          {JSON.stringify(displayJson, null, 2)}
        </pre>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/receipts"
          className="group inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1.5 text-xs text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:text-[--color-fg]"
        >
          <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
          Back to proof trail
        </Link>
        {txSig ? (
          <a
            href={solscanTxUrl(network, txSig)}
            target="_blank"
            rel="noreferrer noopener"
            className="group inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-brand-soft]/40 px-3 py-1.5 text-xs text-[--color-fg] backdrop-blur-md transition-all hover:border-[--color-brand-strong] hover:bg-[--color-brand-soft]"
          >
            View settlement on Solscan
            <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ChainStep({
  label,
  value,
  href,
  active,
}: {
  label: string;
  value: string | null | undefined;
  href?: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-[--color-border] bg-[--color-bg-elev-2]/40 px-3 py-2.5 backdrop-blur-md transition-colors',
        active && 'border-[--color-brand-soft]/70 bg-[--color-brand-soft]/15',
      )}
    >
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          active
            ? 'bg-[--color-brand] shadow-[0_0_8px_oklch(0.66_0.19_268/0.6)]'
            : value
              ? 'bg-[--color-fg-muted]'
              : 'bg-[--color-border-strong]',
        )}
        aria-hidden="true"
      />
      <div className="flex flex-1 flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
          {label}
        </span>
        {value ? (
          href ? (
            <Link
              href={href}
              className="break-all font-mono text-xs text-[--color-fg] hover:text-[--color-brand-strong]"
              title={value}
            >
              {value}
            </Link>
          ) : (
            <span className="break-all font-mono text-xs text-[--color-fg]" title={value}>
              {value}
            </span>
          )
        ) : (
          <span className="font-mono text-xs italic text-[--color-fg-subtle]">genesis</span>
        )}
      </div>
      {value && !active ? (
        <ArrowRight className="h-3 w-3 text-[--color-fg-subtle]" aria-hidden="true" />
      ) : null}
    </div>
  );
}

function ProtocolPill({ value }: { value: 'x402' | 'mpp' }) {
  const cls =
    value === 'mpp'
      ? 'bg-[oklch(0.30_0.14_45/0.45)] text-[oklch(0.9_0.12_75)] ring-1 ring-inset ring-[oklch(0.5_0.16_45/0.35)]'
      : 'bg-[oklch(0.30_0.12_250/0.45)] text-[oklch(0.88_0.08_250)] ring-1 ring-inset ring-[oklch(0.48_0.14_250/0.35)]';
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

function KindPill({ value }: { value: ReceiptRow['kind'] }) {
  const cls =
    value === 'spend'
      ? 'bg-[oklch(0.32_0.13_320/0.5)] text-[oklch(0.85_0.13_320)] ring-1 ring-inset ring-[oklch(0.5_0.18_320/0.3)]'
      : 'bg-[oklch(0.30_0.16_150/0.5)] text-[oklch(0.85_0.16_150)] ring-1 ring-inset ring-[oklch(0.5_0.18_150/0.3)]';
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

function DecisionPill({ value }: { value: ReceiptRow['decision'] }) {
  const cls = {
    allow:
      'bg-[oklch(0.30_0.16_150/0.4)] text-[oklch(0.85_0.16_150)] ring-1 ring-inset ring-[oklch(0.5_0.18_150/0.25)]',
    deny: 'bg-[oklch(0.30_0.18_25/0.4)] text-[oklch(0.85_0.18_25)] ring-1 ring-inset ring-[oklch(0.5_0.2_25/0.25)]',
    rejected:
      'bg-[oklch(0.30_0.18_60/0.4)] text-[oklch(0.85_0.16_60)] ring-1 ring-inset ring-[oklch(0.5_0.2_60/0.25)]',
  }[value];
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
  // On mobile we stack label-above-value so long hashes don't get
  // squeezed into a 150-px gutter; on `sm`+ we revert to the
  // two-column layout the desktop reading flow expects.
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

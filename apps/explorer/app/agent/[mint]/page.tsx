import { notFound } from 'next/navigation';
import { settlementTxSig } from '@leashmarket/schemas';
import { BadgeCheck, Bot, Coins, IdCard, Receipt as ReceiptIcon, ShieldCheck } from 'lucide-react';
import {
  DbUnavailableError,
  getCounterpartiesForTxs,
  getPublicIdentityProfile,
  listEvents,
  listReceipts,
} from '@/lib/db';
import { probeAgentOnOtherNetwork } from '@/lib/cross-network';
import { RpcUnavailableError, getAgentSummaryFor, getTreasuryBalancesFor } from '@/lib/rpc';
import type {
  AgentSummary,
  EventPage,
  PublicIdentityProfile,
  ReceiptPage,
  ReceiptRow,
  TreasuryBalances,
} from '@/lib/types';
import { getNetwork } from '@/lib/server-network';
import type { Network } from '@/lib/network';
import { networkToSlug } from '@/lib/network';
import { EventsTable } from '@/components/events-table';
import { ReceiptsTable } from '@/components/receipts-table';
import { DbUnreachable, RpcUnreachable } from '@/components/empty';
import { Mono } from '@/components/mono';
import { WrongNetworkNotice } from '@/components/wrong-network-notice';
import { LiveRefresh } from '@/components/live-refresh';
import { solscanAddrUrl } from '@/lib/solscan';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ mint: string }> };

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function safeDb<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof DbUnavailableError) return { ok: false, message: err.message };
    throw err;
  }
}

async function safeRpc<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof RpcUnavailableError) return { ok: false, message: err.message };
    throw err;
  }
}

/** Best-effort counterparty join for the agent proof trail. */
async function safeCounterparties(network: Network, rows: ReceiptRow[]) {
  const sigs = rows
    .map((r) => settlementTxSig(r))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  try {
    return await getCounterpartiesForTxs(network, sigs);
  } catch {
    return undefined;
  }
}

export default async function AgentPage({ params }: Props) {
  const { mint } = await params;
  const network = await getNetwork();

  const [summaryRes, balancesRes, eventsRes, receiptsRes, identityRes] = await Promise.all([
    safeRpc<AgentSummary>(() => getAgentSummaryFor(network, mint)),
    safeRpc<TreasuryBalances>(() => getTreasuryBalancesFor(network, mint)),
    safeDb<EventPage>(() => listEvents({ network, agent: mint, limit: 25 })),
    safeDb<ReceiptPage>(() => listReceipts({ network, agent: mint, limit: 25 })),
    safeDb<PublicIdentityProfile | null>(() => getPublicIdentityProfile(network, mint)),
  ]);

  if (!summaryRes.ok && !eventsRes.ok && !receiptsRes.ok) {
    notFound();
  }

  // Detect the "viewing the wrong cluster" case: the local feeds are
  // empty AND the on-chain identity is unregistered AND the SOL/SPL
  // balances all sit at zero. If the same agent has activity on the
  // other cluster, surface a switch-network banner so the user
  // doesn't think the agent is dead.
  const hasLocalActivity =
    (eventsRes.ok && eventsRes.data.items.length > 0) ||
    (receiptsRes.ok && receiptsRes.data.items.length > 0) ||
    (summaryRes.ok && summaryRes.data.has_identity) ||
    (balancesRes.ok && hasAnyBalance(balancesRes.data));

  let crossNetwork: Awaited<ReturnType<typeof probeAgentOnOtherNetwork>> | null = null;
  if (!hasLocalActivity) {
    crossNetwork = await probeAgentOnOtherNetwork(network, mint);
  }

  const identity = identityRes.ok ? identityRes.data : null;

  return (
    <div className="space-y-8">
      {crossNetwork?.foundOnOther ? (
        <WrongNetworkNotice
          current={crossNetwork.current}
          other={crossNetwork.other}
          entity="agent"
          identifier={mint}
        />
      ) : null}
      <header className="card-glow space-y-4 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <Bot className="h-3 w-3 text-[--color-brand]" />
            Agent identity · {networkToSlug(network)}
          </span>
        </div>
        {identity ? (
          <div className="space-y-1">
            <p className="text-lg font-semibold tracking-tight text-[--color-fg]">
              {identity.name}
            </p>
            {identity.handle ? (
              <p className="font-mono text-sm text-[--color-brand-strong]">@{identity.handle}</p>
            ) : null}
          </div>
        ) : null}
        <h1 className="break-all font-mono text-xl tracking-tight text-[--color-fg] sm:text-2xl">
          {mint}
        </h1>
        <p className="max-w-2xl text-sm text-[--color-fg-muted]">
          Canonical public page for this Leash identity: registration, treasury balances, event
          timeline, and proof trail.
        </p>
        {summaryRes.ok ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-[--color-fg-muted]">
            <span>
              Registration:{' '}
              <span className="font-mono text-[--color-fg]">
                {summaryRes.data.has_identity
                  ? `registered (${summaryRes.data.identity?.source})`
                  : 'unregistered'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              Treasury:{' '}
              <Mono
                value={summaryRes.data.treasury}
                external={solscanAddrUrl(network, summaryRes.data.treasury)}
              />
            </span>
            {summaryRes.data.token.has_token ? (
              <span className="inline-flex items-center gap-1">
                Agent token:{' '}
                <Mono
                  value={summaryRes.data.token.mint}
                  external={
                    summaryRes.data.token.mint
                      ? solscanAddrUrl(network, summaryRes.data.token.mint)
                      : undefined
                  }
                />
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {identity ? <IdentityProfile data={identity} /> : null}

      <section className="space-y-3">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Coins className="h-4 w-4 text-[--color-brand]" />
          Treasury balances
        </h2>
        {balancesRes.ok ? (
          <Balances data={balancesRes.data} />
        ) : (
          <RpcUnreachable network={network} message={balancesRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Event timeline</h2>
          <LiveRefresh network={network} intervalSec={5} />
        </div>
        {eventsRes.ok ? (
          <EventsTable
            rows={eventsRes.data.items}
            network={network}
            emptyTitle="No events for this agent yet."
          />
        ) : (
          <DbUnreachable network={network} message={eventsRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ReceiptIcon className="h-4 w-4 text-[--color-brand]" />
          Proof trail
        </h2>
        {receiptsRes.ok ? (
          <ReceiptsTable
            rows={receiptsRes.data.items}
            network={network}
            counterparties={await safeCounterparties(network, receiptsRes.data.items)}
            emptyTitle="No proof receipts published for this identity yet."
          />
        ) : (
          <DbUnreachable network={network} message={receiptsRes.message} />
        )}
      </section>
    </div>
  );
}

function IdentityProfile({ data }: { data: PublicIdentityProfile }) {
  return (
    <section className="space-y-3">
      <h2 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
        <IdCard className="h-4 w-4 text-[--color-brand]" />
        Public identity
      </h2>
      <div className="card-glow space-y-5 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {data.image_url ? (
                <img
                  src={data.image_url}
                  alt=""
                  className="h-10 w-10 rounded-xl border border-[--color-border] object-cover"
                />
              ) : null}
              <div>
                <h3 className="text-base font-semibold tracking-tight">{data.name}</h3>
                {data.handle ? (
                  <p className="font-mono text-xs text-[--color-brand-strong]">@{data.handle}</p>
                ) : null}
              </div>
            </div>
            {data.description ? (
              <p className="mt-3 max-w-2xl text-sm text-[--color-fg-muted]">{data.description}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <ProfileMetric label="Settled" value={String(data.reputation.settled_calls)} />
            <ProfileMetric label="Denied" value={String(data.reputation.denied_calls)} />
            <ProfileMetric label="Rating" value={data.reputation.rating.toFixed(4)} />
          </div>
        </div>

        {data.verified_domains.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.verified_domains.map((domain) => (
              <span
                key={domain}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200"
              >
                <BadgeCheck className="h-3 w-3" />
                {domain}
              </span>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[--color-fg-subtle]">
              Capability cards
            </h3>
            {data.capability_cards.length === 0 ? (
              <p className="text-sm text-[--color-fg-muted]">No public capability cards yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.capability_cards.map((card) => (
                  <li
                    key={card.id}
                    className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{card.title}</span>
                      <span className="rounded-full bg-[--color-brand-soft]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[--color-brand-strong]">
                        {card.kind}
                      </span>
                    </div>
                    {card.endpoint ? (
                      <p className="mt-1 break-all font-mono text-[11px] text-[--color-fg-muted]">
                        {card.endpoint}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[--color-fg-subtle]">
              Signed claims
            </h3>
            {data.claims.length === 0 ? (
              <p className="text-sm text-[--color-fg-muted]">No public signed claims yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.claims.map((claim) => (
                  <li
                    key={claim.id}
                    className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{claim.type}</span>
                      <span className="text-[11px] text-[--color-fg-subtle]">{claim.issuer}</span>
                    </div>
                    <p className="mt-1 text-xs text-[--color-fg-muted]">{claim.value}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 lg:col-span-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[--color-fg-subtle]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Operator history
            </h3>
            {data.operator_history.length === 0 ? (
              <p className="text-sm text-[--color-fg-muted]">
                No public confirmed operator changes yet.
              </p>
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {data.operator_history.map((entry) => (
                  <li
                    key={entry.event_id}
                    className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {operatorHistoryLabel(entry.kind)}
                      </span>
                      <span className="rounded-full bg-[--color-brand-soft]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[--color-brand-strong]">
                        {entry.phase}
                      </span>
                    </div>
                    <div className="mt-1 grid gap-1 text-[11px] text-[--color-fg-muted] sm:grid-cols-2">
                      {entry.delegate ? <span>Delegate {shortAddress(entry.delegate)}</span> : null}
                      {entry.executive ? (
                        <span>Executive {shortAddress(entry.executive)}</span>
                      ) : null}
                      {entry.token_mint ? <span>Mint {shortAddress(entry.token_mint)}</span> : null}
                      {entry.signature ? <span>Tx {shortAddress(entry.signature)}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function operatorHistoryLabel(kind: PublicIdentityProfile['operator_history'][number]['kind']) {
  switch (kind) {
    case 'executive_register':
      return 'Executive registered';
    case 'executive_delegate':
      return 'Executive delegated';
    case 'delegation_set':
      return 'Spend delegation set';
    case 'delegation_revoke':
      return 'Spend delegation revoked';
  }
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-bg-elev]/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[--color-fg-subtle]">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-[--color-fg]">{value}</div>
    </div>
  );
}

function hasAnyBalance(b: TreasuryBalances): boolean {
  if (b.sol.sol > 0) return true;
  return b.spl.some((row) => row.ui_amount > 0);
}

function Balances({ data }: { data: TreasuryBalances }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="card group relative overflow-hidden px-4 py-4 transition-all hover:border-[--color-brand-soft]/60">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[--color-brand-strong]/40 to-transparent opacity-60 transition-opacity group-hover:opacity-100" />
        <p className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">SOL</p>
        <p className="mt-1 font-mono text-lg text-[--color-fg]">
          {data.sol.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })}
        </p>
      </div>
      {data.spl.map((b) => (
        <div
          key={b.mint}
          className="card group relative overflow-hidden px-4 py-4 transition-all hover:border-[--color-brand-soft]/60"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[--color-brand-strong]/40 to-transparent opacity-60 transition-opacity group-hover:opacity-100" />
          <p className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
            {b.symbol ?? 'SPL'}
          </p>
          <p className="mt-1 font-mono text-lg text-[--color-fg]">
            {b.ui_amount.toLocaleString(undefined, { maximumFractionDigits: b.decimals })}
          </p>
          <p className="mt-2 truncate text-[11px] text-[--color-fg-muted]">
            <Mono value={b.mint} truncate copy={false} /> · ata{' '}
            <Mono value={b.ata} truncate copy={false} />
          </p>
        </div>
      ))}
    </div>
  );
}

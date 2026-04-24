import { notFound } from 'next/navigation';
import {
  apiFetch,
  type AgentSummary,
  type EventPage,
  type ReceiptPage,
  type TreasuryBalances,
} from '@/lib/api';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { EventsTable } from '@/components/events-table';
import { ReceiptsTable } from '@/components/receipts-table';
import { ApiUnreachable } from '@/components/empty';
import { Mono } from '@/components/mono';
import { solscanAddrUrl } from '@/lib/solscan';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ mint: string }> };

export default async function AgentPage({ params }: Props) {
  const { mint } = await params;
  const network = await getNetwork();

  const [summaryRes, balancesRes, eventsRes, receiptsRes] = await Promise.all([
    apiFetch<AgentSummary>(network, `/v1/agents/${encodeURIComponent(mint)}`),
    apiFetch<TreasuryBalances>(network, `/v1/agents/${encodeURIComponent(mint)}/treasury/balances`),
    apiFetch<EventPage>(network, `/v1/events?agent=${encodeURIComponent(mint)}&limit=25`),
    apiFetch<ReceiptPage>(network, `/v1/receipts/${encodeURIComponent(mint)}?limit=25`),
  ]);

  if (summaryRes.ok === false && summaryRes.code === 'not_found') {
    notFound();
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
          Agent · {networkToSlug(network)}
        </p>
        <h1 className="break-all font-mono text-2xl font-semibold tracking-tight">{mint}</h1>
        {summaryRes.ok ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[--color-fg-muted]">
            <span>
              Identity:{' '}
              <span className="font-mono text-[--color-fg]">
                {summaryRes.data.has_identity
                  ? `registered (${summaryRes.data.identity?.source})`
                  : 'unregistered'}
              </span>
            </span>
            <span>
              Treasury:{' '}
              <Mono
                value={summaryRes.data.treasury}
                external={solscanAddrUrl(network, summaryRes.data.treasury)}
              />
            </span>
            {summaryRes.data.token.has_token ? (
              <span>
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Treasury balances</h2>
        {balancesRes.ok ? (
          <Balances data={balancesRes.data} />
        ) : (
          <ApiUnreachable network={network} message={balancesRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Event timeline</h2>
        {eventsRes.ok ? (
          <EventsTable
            rows={eventsRes.data.items}
            network={network}
            emptyTitle="No events for this agent yet."
          />
        ) : (
          <ApiUnreachable network={network} message={eventsRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Receipt feed</h2>
        {receiptsRes.ok ? (
          <ReceiptsTable
            rows={receiptsRes.data.items}
            network={network}
            emptyTitle="No receipts published for this agent yet."
          />
        ) : (
          <ApiUnreachable network={network} message={receiptsRes.message} />
        )}
      </section>
    </div>
  );
}

function Balances({ data }: { data: TreasuryBalances }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <div className="card px-4 py-3">
        <p className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">SOL</p>
        <p className="mt-1 font-mono text-lg">
          {data.sol.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })}
        </p>
        <p className="text-xs text-[--color-fg-muted]">
          spendable {data.sol.spendable_sol.toLocaleString(undefined, { maximumFractionDigits: 9 })}
        </p>
      </div>
      {data.spl.map((b) => (
        <div key={b.mint} className="card px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-[--color-fg-subtle]">
            {b.symbol ?? 'SPL'}
          </p>
          <p className="mt-1 font-mono text-lg">
            {b.ui_amount.toLocaleString(undefined, { maximumFractionDigits: b.decimals })}
          </p>
          <p className="text-xs text-[--color-fg-muted]">
            <Mono value={b.mint} truncate copy={false} /> · ata{' '}
            <Mono value={b.ata} truncate copy={false} />
          </p>
        </div>
      ))}
    </div>
  );
}

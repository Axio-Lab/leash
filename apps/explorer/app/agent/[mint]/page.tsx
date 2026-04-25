import { notFound } from 'next/navigation';
import { DbUnavailableError, getCounterpartiesForTxs, listEvents, listReceipts } from '@/lib/db';
import { probeAgentOnOtherNetwork } from '@/lib/cross-network';
import { RpcUnavailableError, getAgentSummaryFor, getTreasuryBalancesFor } from '@/lib/rpc';
import type {
  AgentSummary,
  EventPage,
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

/** Best-effort counterparty join for the agent receipt feed. */
async function safeCounterparties(network: Network, rows: ReceiptRow[]) {
  const sigs = rows
    .map((r) => r.tx_sig)
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

  const [summaryRes, balancesRes, eventsRes, receiptsRes] = await Promise.all([
    safeRpc<AgentSummary>(() => getAgentSummaryFor(network, mint)),
    safeRpc<TreasuryBalances>(() => getTreasuryBalancesFor(network, mint)),
    safeDb<EventPage>(() => listEvents({ network, agent: mint, limit: 25 })),
    safeDb<ReceiptPage>(() => listReceipts({ network, agent: mint, limit: 25 })),
  ]);

  // The agent page is meaningful even for unregistered mints (empty
  // identity panel + empty feeds), so we only 404 when the underlying
  // mint pubkey is malformed enough that the snapshot helper itself
  // throws — which RpcUnavailableError doesn't catch separately. Treat
  // an empty summary with no identity and no recent activity as a
  // valid (but empty) page rather than a hard 404.
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
          <RpcUnreachable network={network} message={balancesRes.message} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Event timeline</h2>
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
        <h2 className="text-lg font-semibold">Receipt feed</h2>
        {receiptsRes.ok ? (
          <ReceiptsTable
            rows={receiptsRes.data.items}
            network={network}
            counterparties={await safeCounterparties(network, receiptsRes.data.items)}
            emptyTitle="No receipts published for this agent yet."
          />
        ) : (
          <DbUnreachable network={network} message={receiptsRes.message} />
        )}
      </section>
    </div>
  );
}

/**
 * "Has this treasury ever held anything?" — a non-zero SOL or SPL
 * balance is enough to consider the agent alive on this cluster, even
 * if it has no Leash events yet (e.g. user just funded the wallet).
 */
function hasAnyBalance(b: TreasuryBalances): boolean {
  if (b.sol.sol > 0) return true;
  return b.spl.some((row) => row.ui_amount > 0);
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

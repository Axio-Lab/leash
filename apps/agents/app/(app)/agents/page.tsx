'use client';

import Link from 'next/link';
import useSWR from 'swr';

type AgentItem = {
  mint: string;
  name: string;
  network: 'solana-devnet' | 'solana-mainnet';
  treasury: string;
  status: 'active' | 'disabled';
  capabilities: Array<{ slug: string | null; endpoint: string; tools: string[] }>;
  created_at: string;
};

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { items: AgentItem[] };
};

export default function AgentsPage() {
  const { data, error, isLoading } = useSWR<{ items: AgentItem[] }>('/api/agents', fetcher);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your agents</h1>
          <p className="text-fg-muted text-sm mt-1">
            Each agent is an MPL Core asset on Solana with its own treasury PDA.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong"
        >
          + New agent
        </Link>
      </div>
      {isLoading ? (
        <div className="text-fg-muted text-sm">Loading…</div>
      ) : error ? (
        <div className="text-danger text-sm">{(error as Error).message}</div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-bg-elev p-8 text-center text-sm text-fg-muted">
          No agents yet.{' '}
          <Link href="/agents/new" className="text-brand">
            Create your first agent
          </Link>
          .
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.items.map((a) => (
            <li key={a.mint} className="rounded-lg border bg-bg-elev p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{a.name}</div>
                <span
                  className={
                    a.network === 'solana-devnet'
                      ? 'rounded-full px-2 py-0.5 text-xs bg-amber-950/40 text-amber-300'
                      : 'rounded-full px-2 py-0.5 text-xs bg-emerald-950/40 text-emerald-300'
                  }
                >
                  {a.network === 'solana-devnet' ? 'Devnet' : 'Mainnet'}
                </span>
              </div>
              <div className="text-xs text-fg-muted">
                Mint:{' '}
                <span className="font-mono">
                  {a.mint.slice(0, 8)}…{a.mint.slice(-4)}
                </span>
              </div>
              <div className="text-xs text-fg-muted">
                Treasury:{' '}
                <span className="font-mono">
                  {a.treasury.slice(0, 8)}…{a.treasury.slice(-4)}
                </span>
              </div>
              <div className="text-xs text-fg-muted">
                Tools: {a.capabilities.length === 0 ? 'none' : a.capabilities.length}
              </div>
              <div className="flex gap-2 pt-1">
                <Link
                  href={`/agents/${a.mint}`}
                  className="text-xs rounded-md border px-2 py-1 hover:border-border-strong"
                >
                  Overview
                </Link>
                <Link
                  href={`/agents/${a.mint}/fund`}
                  className="text-xs rounded-md border px-2 py-1 hover:border-border-strong"
                >
                  Fund
                </Link>
                <Link
                  href={`/agents/${a.mint}/tasks/new`}
                  className="text-xs rounded-md bg-brand px-2 py-1 text-white hover:bg-brand-strong"
                >
                  New task
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

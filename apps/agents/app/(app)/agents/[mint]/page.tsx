'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import useSWR from 'swr';

type Agent = {
  mint: string;
  name: string;
  network: 'solana-devnet' | 'solana-mainnet';
  treasury: string;
  model: string;
  capabilities: Array<{ slug: string | null; endpoint: string; tools: string[] }>;
};

type Task = {
  id: string;
  prompt: string;
  status: string;
  spent: string;
  budget_cap: string;
  created_at: string;
};

const json = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export default function AgentOverviewPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const { data: list } = useSWR<{ items: Agent[] }>('/api/agents', json);
  const agent = list?.items.find((a) => a.mint === mint) ?? null;
  const { data: tasks } = useSWR<{ items: Task[] }>(`/api/agents/${mint}/tasks`, json);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{agent?.name ?? 'Agent'}</h1>
          <p className="text-fg-muted text-sm font-mono mt-1">{mint}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/agents/${mint}/fund`}
            className="rounded-md border px-3 py-2 text-sm hover:border-border-strong"
          >
            Fund
          </Link>
          <Link
            href={`/agents/${mint}/tasks/new`}
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong"
          >
            New task
          </Link>
        </div>
      </div>
      {agent ? (
        <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
          <dt className="text-fg-muted">Network</dt>
          <dd>{agent.network}</dd>
          <dt className="text-fg-muted">Model</dt>
          <dd>{agent.model}</dd>
          <dt className="text-fg-muted">Treasury</dt>
          <dd className="font-mono">{agent.treasury}</dd>
          <dt className="text-fg-muted">Tools</dt>
          <dd>
            {agent.capabilities.length === 0
              ? 'none'
              : agent.capabilities.map((c, i) => (
                  <span key={i} className="block">
                    {c.slug ?? c.endpoint}{' '}
                    <span className="text-fg-muted">({c.tools.join(', ')})</span>
                  </span>
                ))}
          </dd>
        </dl>
      ) : null}
      <div>
        <h2 className="text-base font-medium mb-2">Tasks</h2>
        {!tasks ? (
          <div className="text-fg-muted text-sm">Loading…</div>
        ) : tasks.items.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-bg-elev p-6 text-center text-sm text-fg-muted">
            No tasks yet. Click <span className="text-fg">New task</span>.
          </div>
        ) : (
          <ul className="rounded-lg border bg-bg-elev divide-y">
            {tasks.items.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="truncate">{t.prompt}</div>
                  <div className="text-xs text-fg-muted mt-0.5">
                    Spent {t.spent} / {t.budget_cap} USDC ·{' '}
                    {new Date(t.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={t.status} />
                  <Link
                    href={`/agents/${mint}/tasks/${t.id}`}
                    className="text-xs text-brand hover:underline"
                  >
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'done'
      ? 'bg-emerald-950/40 text-emerald-300'
      : status === 'running'
        ? 'bg-blue-950/40 text-blue-300'
        : status === 'failed' || status === 'out_of_budget'
          ? 'bg-rose-950/40 text-rose-300'
          : 'bg-fg-subtle/10 text-fg-muted';
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{status}</span>;
}

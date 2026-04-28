'use client';

import Link from 'next/link';
import { use } from 'react';
import useSWR from 'swr';

import { ActivityFeed } from '@/components/activity-feed';

const json = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

type Task = {
  id: string;
  agent_mint: string;
  prompt: string;
  budget_cap: string;
  status: string;
  spent: string;
  final_output: string | null;
  error: string | null;
  created_at: string;
};

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ mint: string; id: string }>;
}) {
  const { id, mint } = use(params);
  const { data: task } = useSWR<Task>(`/api/tasks/${id}`, json, { refreshInterval: 1500 });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight truncate">{task?.prompt ?? 'Task'}</h1>
        <p className="text-fg-muted text-sm font-mono mt-1 truncate">
          {mint} · task {id}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card label="Status" value={task?.status ?? '…'} />
        <Card label="Spent" value={task ? `${task.spent} / ${task.budget_cap} USDC` : '…'} />
        <Card label="Started" value={task ? new Date(task.created_at).toLocaleString() : '…'} />
      </div>
      {task?.status === 'out_of_budget' ? (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/30 p-4 flex items-start justify-between gap-3">
          <div className="text-amber-200 text-sm">
            <div className="font-medium">Out of budget.</div>
            <div className="mt-1 opacity-90">
              Top up the agent treasury or raise the per-task cap and try again.
            </div>
          </div>
          <Link
            href={`/agents/${mint}/fund`}
            className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
          >
            Top up
          </Link>
        </div>
      ) : null}
      {task?.status === 'failed' ? (
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/30 p-4 flex items-start justify-between gap-3">
          <div className="text-rose-200 text-sm">
            <div className="font-medium">Task failed.</div>
            <div className="mt-1 opacity-90">
              {task.error ?? 'Try a smaller scope or a different tool.'}
            </div>
          </div>
          <Link
            href={`/agents/${mint}/tasks/new`}
            className="rounded-md bg-rose-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
          >
            Retry
          </Link>
        </div>
      ) : null}
      <ActivityFeed taskId={id} />
      {task?.final_output ? (
        <div className="rounded-lg border bg-bg-elev p-4">
          <div className="text-xs text-fg-muted mb-1">Final output</div>
          <div className="text-sm whitespace-pre-line">{task.final_output}</div>
        </div>
      ) : null}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-bg-elev px-4 py-3">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="text-sm mt-1">{value}</div>
    </div>
  );
}

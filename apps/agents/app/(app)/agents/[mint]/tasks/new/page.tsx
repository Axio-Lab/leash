'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewTaskPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [budget, setBudget] = useState('1.00');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ agent_mint: mint, prompt, budget_cap: budget }),
      });
      const body = (await res.json()) as { id?: string; error?: string; message?: string };
      if (!res.ok || !body.id) {
        throw new Error(body.message ?? 'failed to enqueue task');
      }
      router.push(`/agents/${mint}/tasks/${body.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New task</h1>
        <p className="text-fg-muted text-sm mt-1">
          Tell the agent what to do. The runtime picks tools, calls them, and pays per call.
        </p>
      </div>
      <form onSubmit={submit} className="rounded-lg border bg-bg-elev p-5 space-y-4">
        <label className="block">
          <span className="text-xs text-fg-muted">Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Find the cheapest Solana RPC and recharge +234… with $5 airtime."
            className="mt-1 w-full rounded-md border bg-bg px-3 py-2 text-sm"
            required
          />
        </label>
        <label className="block">
          <span className="text-xs text-fg-muted">Max budget for this run (USDC)</span>
          <input
            type="text"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="mt-1 w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono"
            required
          />
        </label>
        {error ? <div className="text-danger text-xs">{error}</div> : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || prompt.length === 0}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Run task'}
          </button>
        </div>
      </form>
    </div>
  );
}

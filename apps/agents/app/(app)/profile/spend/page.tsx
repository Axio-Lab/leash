'use client';

import * as React from 'react';
import useSWR from 'swr';
import { SaveIcon, WalletIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type AgentItem = {
  mint: string;
  name?: string;
  budget?: { per_action?: string; per_task?: string; per_day?: string };
};

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ items: AgentItem[] }>;
};

function formatUsdc(value?: string): string {
  if (!value) return '0';
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
    useGrouping: true,
  }).format(n);
}

export default function ProfileSpendPage() {
  const { data, isLoading, error, mutate } = useSWR('/api/agents', fetcher);
  const agent = data?.items?.[0];
  const [form, setForm] = React.useState({
    per_action: '10',
    per_task: '50',
    per_day: '100',
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!agent?.budget) return;
    setForm({
      per_action: agent.budget.per_action ?? '10',
      per_task: agent.budget.per_task ?? '50',
      per_day: agent.budget.per_day ?? '100',
    });
  }, [agent?.budget?.per_action, agent?.budget?.per_task, agent?.budget?.per_day]);

  async function save() {
    if (!agent?.mint) return;
    const parsed = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, Number.parseFloat(v)]),
    ) as Record<string, number>;
    if (
      !Number.isFinite(parsed.per_action) ||
      !Number.isFinite(parsed.per_task) ||
      !Number.isFinite(parsed.per_day) ||
      parsed.per_action <= 0 ||
      parsed.per_task <= 0 ||
      parsed.per_day <= 0
    ) {
      toast.error('Invalid spend limits', {
        description: 'Enter positive numbers for all three caps.',
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.mint)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budget: form }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 160)}` : ''}`);
      }
      toast.success('Spend controls updated');
      await mutate();
    } catch (e) {
      toast.error('Could not update spend controls', {
        description: e instanceof Error ? e.message : 'unknown error',
      });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-muted py-10">
        <Spinner size="sm" /> Loading spend controls
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/8 p-4 text-sm text-danger">
        Could not load spend controls: {(error as Error).message}
      </div>
    );
  }

  if (!agent?.mint) {
    return (
      <div className="rounded-xl border border-border bg-bg-elev/60 p-5 text-sm text-fg-muted">
        Set up your on-chain agent first. Spend controls appear after minting.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-bg-elev/60 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-strong">
            <WalletIcon className="size-4.5" />
          </span>
          <div className="space-y-1 text-sm text-fg-muted">
            <h2 className="text-fg font-medium text-base">Spend controls</h2>
            <p>
              These caps are enforced by the facilitator on every treasury payment. Update them here
              anytime.
            </p>
            <p className="text-xs text-fg-subtle">
              Agent: <span className="font-medium text-fg">{agent.name ?? agent.mint}</span>
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <ReadRow label="Current per action" value={formatUsdc(agent.budget?.per_action)} />
          <ReadRow label="Current per task" value={formatUsdc(agent.budget?.per_task)} />
          <ReadRow label="Current per day" value={formatUsdc(agent.budget?.per_day)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <BudgetInput
            label="Per action"
            value={form.per_action}
            onChange={(v) => setForm((f) => ({ ...f, per_action: v }))}
          />
          <BudgetInput
            label="Per task"
            value={form.per_task}
            onChange={(v) => setForm((f) => ({ ...f, per_task: v }))}
          />
          <BudgetInput
            label="Per day"
            value={form.per_day}
            onChange={(v) => setForm((f) => ({ ...f, per_day: v }))}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner size="xs" /> : <SaveIcon className="size-4" />}
            Save caps
          </Button>
        </div>
      </section>
    </div>
  );
}

function BudgetInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</span>
      <div className="rounded-lg border border-border bg-bg/60 px-3 py-2 flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent outline-none text-sm font-mono"
        />
        <span className="text-xs text-fg-subtle">USDC</span>
      </div>
    </label>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
      <div className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</div>
      <div className="mt-1 text-sm font-mono">
        {value} <span className="text-fg-subtle">USDC</span>
      </div>
    </div>
  );
}

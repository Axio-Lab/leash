'use client';

import * as React from 'react';
import useSWR from 'swr';
import { SaveIcon, WalletIcon, InfinityIcon } from 'lucide-react';
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

const UNLIMITED = 'unlimited';

function isUnlimitedValue(v?: string): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === UNLIMITED || t === 'inf' || t === 'infinity';
}

function formatUsdc(value?: string): string {
  if (!value) return '0';
  if (isUnlimitedValue(value)) return 'Unlimited';
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
  const [unlimited, setUnlimited] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!agent?.budget) return;
    const allUnlimited =
      isUnlimitedValue(agent.budget.per_action) &&
      isUnlimitedValue(agent.budget.per_task) &&
      isUnlimitedValue(agent.budget.per_day);
    setUnlimited(allUnlimited);
    setForm({
      per_action: isUnlimitedValue(agent.budget.per_action)
        ? '10'
        : (agent.budget.per_action ?? '10'),
      per_task: isUnlimitedValue(agent.budget.per_task) ? '50' : (agent.budget.per_task ?? '50'),
      per_day: isUnlimitedValue(agent.budget.per_day) ? '100' : (agent.budget.per_day ?? '100'),
    });
  }, [agent?.budget?.per_action, agent?.budget?.per_task, agent?.budget?.per_day]);

  async function save() {
    if (!agent?.mint) return;
    const body = unlimited
      ? { per_action: UNLIMITED, per_task: UNLIMITED, per_day: UNLIMITED }
      : form;
    if (!unlimited) {
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
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.mint)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budget: body }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 160)}` : ''}`);
      }
      toast.success(unlimited ? 'Spend caps removed (manual approval)' : 'Spend controls updated');
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
              These caps are enforced on every treasury payment. Set them here, or remove them
              entirely if you'd rather approve each payment yourself.
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

        <UnlimitedToggle checked={unlimited} onChange={setUnlimited} />

        <div className="grid gap-3 sm:grid-cols-3">
          <BudgetInput
            label="Per action"
            value={form.per_action}
            onChange={(v) => setForm((f) => ({ ...f, per_action: v }))}
            disabled={unlimited}
          />
          <BudgetInput
            label="Per task"
            value={form.per_task}
            onChange={(v) => setForm((f) => ({ ...f, per_task: v }))}
            disabled={unlimited}
          />
          <BudgetInput
            label="Per day"
            value={form.per_day}
            onChange={(v) => setForm((f) => ({ ...f, per_day: v }))}
            disabled={unlimited}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner size="xs" /> : <SaveIcon className="size-4" />}
            {unlimited ? 'Save (unlimited)' : 'Save caps'}
          </Button>
        </div>
      </section>
    </div>
  );
}

function UnlimitedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
        checked ? 'border-brand/40 bg-brand/8' : 'border-border bg-bg/40 hover:border-border-strong'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 cursor-pointer accent-brand"
      />
      <span className="flex flex-1 items-start gap-2 text-sm">
        <InfinityIcon
          className={`mt-0.5 size-4 shrink-0 ${checked ? 'text-brand-strong' : 'text-fg-subtle'}`}
        />
        <span className="space-y-0.5">
          <span className={`block font-medium ${checked ? 'text-fg' : 'text-fg'}`}>
            Unlimited (approve each payment manually)
          </span>
          <span className="block text-xs text-fg-muted leading-snug">
            Removes the per-action / per-task / per-day soft caps. Every Pay card still requires
            your wallet signature, so you stay the final approver. The on-chain SPL delegate
            allowance set at onboarding remains the hard ceiling.
          </span>
        </span>
      </span>
    </label>
  );
}

function BudgetInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`space-y-1 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</span>
      <div
        className={`rounded-lg border bg-bg/60 px-3 py-2 flex items-center gap-2 ${
          disabled ? 'border-border/40' : 'border-border'
        }`}
      >
        {disabled ? (
          <div className="flex w-full items-center gap-1 font-mono text-sm text-fg-subtle">
            <InfinityIcon className="size-3.5" />
            <span>unlimited</span>
          </div>
        ) : (
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-transparent outline-none text-sm font-mono"
          />
        )}
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

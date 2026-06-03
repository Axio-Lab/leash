'use client';

import * as React from 'react';
import useSWR from 'swr';
import {
  ChevronRightIcon,
  CalendarClockIcon,
  InfinityIcon,
  KeyIcon,
  RefreshCwIcon,
  SaveIcon,
  WalletIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  KNOWN_STABLES,
  createNativeSubscriptionPlan,
  getNativeSubscriptionAuthority,
  getSpendDelegation,
  initNativeSubscriptionAuthority,
  setSpendDelegation,
} from '@leashmarket/registry-utils';
import type { Umi } from '@metaplex-foundation/umi';
import { usePrivy } from '@privy-io/react-auth';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SOLANA_NETWORK } from '@/lib/env';
import { formatChainError } from '@/lib/format-chain-error';
import { usePrivyUmi } from '@/lib/use-privy-umi';

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

      <OnchainAllowancePanel
        agentMint={agent.mint}
        suggestedAmount={unlimited ? UNLIMITED : form.per_day}
      />

      <NativeSubscriptionPanel agentMint={agent.mint} />
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

/**
 * Cap to use on-chain when the user picks "Unlimited" — 10^9 atomic
 * units (= 1B USDC, given 6 decimals). Big enough to be practically
 * unlimited; small enough to comfortably fit u64 with room to spare.
 * Bumping it later is a one-tx re-issue, not a migration.
 */
const UNLIMITED_ATOMIC = 1_000_000_000_000_000n; // 1B with 6 decimals

type StableRow = {
  symbol: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  /** Current on-chain delegated amount, in atomic units. `null` until loaded. */
  delegatedAtomic: bigint | null;
  /** Connected delegate (executive) address — `null` if none / unread. */
  delegate: string | null;
};

function OnchainAllowancePanel({
  agentMint,
  suggestedAmount,
}: {
  agentMint: string;
  suggestedAmount: string;
}) {
  const { umi, wallet, ready } = usePrivyUmi();
  const { user } = usePrivy();
  void user; // hook reserved for future "show owner email" affordance

  const network = SOLANA_NETWORK === 'solana-mainnet' ? 'solana-mainnet' : 'solana-devnet';
  const stables = React.useMemo(() => KNOWN_STABLES[network], [network]);

  const [rows, setRows] = React.useState<StableRow[]>(() =>
    stables.map((s) => ({
      symbol: s.symbol,
      mint: String(s.mint),
      tokenProgram: String(s.tokenProgram),
      decimals: 6,
      delegatedAtomic: null,
      delegate: null,
    })),
  );
  const [loading, setLoading] = React.useState(false);
  const [reissuing, setReissuing] = React.useState(false);

  const refresh = React.useCallback(
    async (currentUmi: Umi) => {
      setLoading(true);
      try {
        const next = await Promise.all(
          stables.map(async (s) => {
            const status = await getSpendDelegation(currentUmi, {
              agentAsset: agentMint,
              mint: s.mint,
              tokenProgram: s.tokenProgram,
            });
            return {
              symbol: s.symbol,
              mint: String(s.mint),
              tokenProgram: String(s.tokenProgram),
              decimals: 6,
              delegatedAtomic: status.delegatedAmount,
              delegate: status.delegate,
            } satisfies StableRow;
          }),
        );
        setRows(next);
      } catch (e) {
        toast.error('Could not read on-chain allowance', {
          description: formatChainError(e),
        });
      } finally {
        setLoading(false);
      }
    },
    [stables, agentMint],
  );

  React.useEffect(() => {
    if (!umi) return;
    void refresh(umi);
  }, [umi, refresh]);

  const isUnlimited = isUnlimitedValue(suggestedAmount);
  const targetDecimal = isUnlimited ? null : Number.parseFloat(suggestedAmount);
  const targetValid =
    isUnlimited || (Number.isFinite(targetDecimal) && (targetDecimal as number) > 0);
  const targetLabel = isUnlimited
    ? 'Unlimited (1B per token)'
    : Number.isFinite(targetDecimal) && (targetDecimal as number) > 0
      ? `${formatUsdc(suggestedAmount)} per token`
      : '—';

  async function reissue() {
    if (!umi || !wallet || !ready) {
      toast.error('Wallet not ready', {
        description: 'Connect your Privy wallet first.',
      });
      return;
    }
    if (!targetValid) {
      toast.error('Set a valid per-day cap first', {
        description: 'On-chain allowance mirrors the per-day cap.',
      });
      return;
    }
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        isUnlimited
          ? 'Re-issue on-chain spend allowance to ~1,000,000,000 per token? This signs three transactions (USDC, USDT, USDG).'
          : `Re-issue on-chain spend allowance to ${formatUsdc(suggestedAmount)} per token? This signs three transactions (USDC, USDT, USDG).`,
      );
      if (!ok) return;
    }
    setReissuing(true);
    let successes = 0;
    try {
      for (const s of stables) {
        const atomic = isUnlimited
          ? UNLIMITED_ATOMIC
          : BigInt(Math.floor(((targetDecimal as number) ?? 0) * 10 ** 6));
        if (atomic <= 0n) continue;
        try {
          await setSpendDelegation(umi, {
            agentAsset: agentMint,
            mint: s.mint,
            executive: wallet.address,
            amount: atomic,
            tokenProgram: s.tokenProgram,
          });
          successes += 1;
          toast.success(`Re-issued ${s.symbol}`);
        } catch (e) {
          toast.error(`${s.symbol} re-issue failed`, {
            description: formatChainError(e),
          });
        }
      }
      await refresh(umi);
    } finally {
      setReissuing(false);
    }
    if (successes === stables.length) {
      toast.success('On-chain allowance updated for every supported stable.');
    }
  }

  const allowanceMatches = rows.every((r) => {
    if (r.delegatedAtomic === null) return true;
    if (isUnlimited) {
      return r.delegatedAtomic >= UNLIMITED_ATOMIC / 2n;
    }
    if (!Number.isFinite(targetDecimal)) return true;
    const want = BigInt(Math.floor(((targetDecimal as number) ?? 0) * 10 ** 6));
    return r.delegatedAtomic === want;
  });

  return (
    <section className="rounded-xl border border-border bg-bg-elev/60 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-strong">
          <KeyIcon className="size-4.5" />
        </span>
        <div className="space-y-1 text-sm text-fg-muted flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-fg font-medium text-base">On-chain spend allowance</h2>
            <button
              type="button"
              onClick={() => umi && void refresh(umi)}
              disabled={!umi || loading}
              className="inline-flex items-center justify-center rounded-md border border-border p-1 text-fg-muted hover:border-border-strong hover:text-fg disabled:opacity-50"
              title="Refresh on-chain reads"
              aria-label="Refresh"
            >
              <RefreshCwIcon className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p>
            The hard ceiling enforced by Solana itself. Each payment debits this allowance; once
            it's exhausted the executive can't spend until the owner re-issues.
          </p>
          <p className="text-xs text-fg-subtle">
            Target on re-issue: <span className="font-medium text-fg">{targetLabel}</span>
          </p>
        </div>
      </div>

      <ul className="grid gap-2.5 sm:grid-cols-3">
        {rows.map((r) => (
          <li
            key={r.symbol}
            className="rounded-lg border border-border/60 bg-bg/40 p-3 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-fg-subtle">{r.symbol}</div>
              <div className="font-mono text-sm">
                {r.delegatedAtomic === null ? (
                  <span className="text-fg-subtle">…</span>
                ) : (
                  <>
                    {formatAtomic(r.delegatedAtomic, r.decimals)}{' '}
                    <span className="text-fg-subtle">{r.symbol}</span>
                  </>
                )}
              </div>
            </div>
            {r.delegate ? (
              <div className="text-[10px] text-fg-subtle font-mono shrink-0">
                {r.delegate.slice(0, 4)}…{r.delegate.slice(-4)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {!allowanceMatches ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/8 px-2 py-1.5 text-[11px] text-warning leading-snug">
          <ChevronRightIcon className="size-3.5 shrink-0 mt-0.5" />
          <span>
            On-chain allowance is out of sync with your per-day cap. Re-issue to align them so
            payments don't fail mid-flight.
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          onClick={reissue}
          disabled={reissuing || !ready || !umi || !targetValid}
        >
          {reissuing ? <Spinner size="xs" /> : <KeyIcon className="size-4" />}
          {reissuing ? 'Signing…' : 'Re-issue allowance'}
        </Button>
      </div>
    </section>
  );
}

function formatAtomic(atomic: bigint, decimals: number): string {
  if (atomic === 0n) return '0';
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = atomic % base;
  const wholeStr = new Intl.NumberFormat('en-US').format(whole);
  if (frac === 0n) return wholeStr;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${wholeStr}.${fracStr}` : wholeStr;
}

function NativeSubscriptionPanel({ agentMint }: { agentMint: string }) {
  const { umi, wallet, ready } = usePrivyUmi();
  const network = SOLANA_NETWORK === 'solana-mainnet' ? 'solana-mainnet' : 'solana-devnet';
  const usdc = React.useMemo(
    () => KNOWN_STABLES[network].find((s) => s.symbol === 'USDC'),
    [network],
  );
  const [authority, setAuthority] = React.useState<{
    exists: boolean;
    authority: string;
    initId: string | null;
  } | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [creatingAuthority, setCreatingAuthority] = React.useState(false);
  const [creatingPlan, setCreatingPlan] = React.useState(false);
  const [planForm, setPlanForm] = React.useState({
    planId: String(Math.floor(Date.now() / 1000)),
    amount: '10',
    periodHours: '720',
    metadataUri: '',
  });
  const [lastPlan, setLastPlan] = React.useState<{ plan: string; signature: string } | null>(null);

  const refreshAuthority = React.useCallback(async () => {
    if (!umi || !wallet || !usdc) return;
    setChecking(true);
    try {
      const status = await getNativeSubscriptionAuthority(umi, {
        owner: wallet.address,
        mint: usdc.mint,
        tokenProgram: usdc.tokenProgram,
      });
      setAuthority({
        exists: status.exists,
        authority: status.authority,
        initId: status.initId?.toString() ?? null,
      });
    } catch (e) {
      toast.error('Could not read native authority', {
        description: formatChainError(e),
      });
    } finally {
      setChecking(false);
    }
  }, [umi, wallet, usdc]);

  React.useEffect(() => {
    void refreshAuthority();
  }, [refreshAuthority]);

  async function initializeAuthority() {
    if (!umi || !wallet || !usdc || !ready) {
      toast.error('Wallet not ready');
      return;
    }
    setCreatingAuthority(true);
    try {
      const result = await initNativeSubscriptionAuthority(umi, {
        mint: usdc.mint,
        tokenProgram: usdc.tokenProgram,
      });
      toast.success('Native subscription authority created');
      setAuthority({
        exists: true,
        authority: result.authority,
        initId: null,
      });
      await refreshAuthority();
    } catch (e) {
      toast.error('Could not initialize native authority', {
        description: formatChainError(e),
      });
    } finally {
      setCreatingAuthority(false);
    }
  }

  async function createPlan() {
    if (!umi || !wallet || !usdc || !ready) {
      toast.error('Wallet not ready');
      return;
    }
    const amount = Number.parseFloat(planForm.amount);
    const periodHours = Number.parseInt(planForm.periodHours, 10);
    const planId = BigInt(planForm.planId || '0');
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(periodHours) ||
      periodHours <= 0
    ) {
      toast.error('Invalid subscription plan');
      return;
    }
    setCreatingPlan(true);
    try {
      const result = await createNativeSubscriptionPlan(umi, {
        mint: usdc.mint,
        tokenProgram: usdc.tokenProgram,
        planId,
        amount: BigInt(Math.floor(amount * 1_000_000)),
        periodHours: BigInt(periodHours),
        destinations: [wallet.address],
        pullers: [wallet.address],
        metadataUri: planForm.metadataUri.trim(),
      });
      setLastPlan({ plan: result.plan, signature: result.signature });
      toast.success('Native subscription plan created');
    } catch (e) {
      toast.error('Could not create subscription plan', {
        description: formatChainError(e),
      });
    } finally {
      setCreatingPlan(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-bg-elev/60 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-strong">
          <CalendarClockIcon className="size-4.5" />
        </span>
        <div className="space-y-1 text-sm text-fg-muted flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-fg font-medium text-base">Native recurring services</h2>
            <button
              type="button"
              onClick={() => void refreshAuthority()}
              disabled={!umi || checking}
              className="inline-flex items-center justify-center rounded-md border border-border p-1 text-fg-muted hover:border-border-strong hover:text-fg disabled:opacity-50"
              title="Refresh native authority"
              aria-label="Refresh native authority"
            >
              <RefreshCwIcon className={`size-3.5 ${checking ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p>
            Create a wallet-owned native Solana subscription plan that other wallets or agents can
            subscribe to for recurring service payments.
          </p>
          <p className="text-xs text-fg-subtle">
            Agent:{' '}
            <span className="font-mono text-fg">
              {agentMint.slice(0, 4)}…{agentMint.slice(-4)}
            </span>
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-bg/40 p-3 text-sm">
        <div className="text-[11px] uppercase tracking-widest text-fg-subtle">Authority</div>
        <div className="mt-1 font-mono text-xs text-fg-muted break-all">
          {authority?.authority ?? 'not checked'}
        </div>
        <div className="mt-1 text-xs text-fg-subtle">
          {authority?.exists
            ? `initialized${authority.initId ? ` · init ${authority.initId}` : ''}`
            : 'not initialized'}
        </div>
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            onClick={initializeAuthority}
            disabled={creatingAuthority || !ready || authority?.exists === true}
          >
            {creatingAuthority ? <Spinner size="xs" /> : <KeyIcon className="size-4" />}
            Initialize authority
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <NativeInput
          label="Plan ID"
          value={planForm.planId}
          onChange={(v) => setPlanForm((f) => ({ ...f, planId: v }))}
        />
        <NativeInput
          label="Amount"
          value={planForm.amount}
          onChange={(v) => setPlanForm((f) => ({ ...f, amount: v }))}
          suffix="USDC"
        />
        <NativeInput
          label="Period hours"
          value={planForm.periodHours}
          onChange={(v) => setPlanForm((f) => ({ ...f, periodHours: v }))}
          suffix="hours"
        />
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px] uppercase tracking-widest text-fg-subtle">Metadata URI</span>
        <input
          type="url"
          value={planForm.metadataUri}
          onChange={(e) => setPlanForm((f) => ({ ...f, metadataUri: e.target.value }))}
          placeholder="https://example.com/subscription-plan.json"
          className="w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm outline-none"
        />
      </label>

      {lastPlan ? (
        <div className="rounded-lg border border-border/60 bg-bg/40 p-3 text-xs">
          <div className="text-[11px] uppercase tracking-widest text-fg-subtle">Last plan</div>
          <div className="mt-1 font-mono break-all">{lastPlan.plan}</div>
          <div className="mt-1 font-mono text-fg-muted break-all">{lastPlan.signature}</div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={createPlan} disabled={creatingPlan || !ready}>
          {creatingPlan ? <Spinner size="xs" /> : <CalendarClockIcon className="size-4" />}
          Create subscription plan
        </Button>
      </div>
    </section>
  );
}

function NativeInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg/60 px-3 py-2">
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent font-mono text-sm outline-none"
        />
        {suffix ? <span className="text-xs text-fg-subtle">{suffix}</span> : null}
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

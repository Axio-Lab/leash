'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';
import { toast } from 'sonner';
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  PlusIcon,
  ShieldIcon,
  WalletIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { OnboardingGate } from '@/components/chat/onboarding-gate';
import { TreasuryPanel } from '@/components/profile/treasury-panel';
import { getStoredActiveAgentMint, setStoredActiveAgentMint } from '@/lib/active-agent';
import { NEXT_PUBLIC_EXPLORER_URL, SOLANA_NETWORK } from '@/lib/env';

type AgentItem = {
  mint?: string;
  treasury?: string;
  name?: string;
  network?: string;
  system_prompt?: string;
  description?: string;
  image_url?: string | null;
  services?: Array<{ name: string; endpoint: string }>;
  budget?: { per_action?: string; per_task?: string; per_day?: string };
};

const EMPTY_AGENTS: AgentItem[] = [];
const AGENTS_PER_PAGE = 2;

const agentsFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ items: AgentItem[]; warning?: string }>;
};

function explorerUrl(mintOrAddr: string, network: string): string {
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/account/${mintOrAddr}${cluster}`;
}

function copyToClipboard(value: string | undefined, label = 'Copied') {
  if (!value) return;
  void navigator.clipboard?.writeText(value);
  toast.success(label, { description: value });
}

function formatUsdc(value?: string): string {
  if (!value) return '—';
  const t = value.trim().toLowerCase();
  if (t === 'unlimited' || t === 'inf' || t === 'infinity') return 'Unlimited';
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
    useGrouping: true,
  }).format(n);
}

function shortAddress(value?: string): string {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function networkLabel(network?: string): string {
  if (network === 'solana-mainnet') return 'Mainnet';
  if (network === 'solana-devnet') return 'Devnet';
  return network ?? 'Unknown';
}

export default function ProfileAgentPage() {
  const { user } = usePrivy();
  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solanaWallet = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solanaWallet?.address ?? '';
  const [selectedMint, setSelectedMint] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const { data, error, isLoading, mutate } = useSWR<{
    items: AgentItem[];
    warning?: string;
  }>('/api/agents', agentsFetcher);

  const agents = data?.items ?? EMPTY_AGENTS;

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mint = params.get('agent');
    if (mint) {
      setSelectedMint(mint);
      setStoredActiveAgentMint(mint);
    } else {
      const stored = getStoredActiveAgentMint();
      if (stored) setSelectedMint(stored);
    }
    if (params.get('create') === '1') setCreating(true);
  }, []);

  React.useEffect(() => {
    if (selectedMint || !agents[0]?.mint) return;
    setSelectedMint(agents[0].mint);
    setStoredActiveAgentMint(agents[0].mint);
  }, [agents, selectedMint]);

  const selected = agents.find((agent) => agent.mint === selectedMint) ?? agents[0] ?? null;
  const hasAgent = Boolean(selected?.mint);

  function selectAgent(mint: string) {
    setSelectedMint(mint);
    setStoredActiveAgentMint(mint);
    setCreating(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-muted py-12 justify-center">
        <Spinner size="sm" /> Loading agent
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/8 p-4 text-sm text-danger">
        Could not load agents: {(error as Error).message}
      </div>
    );
  }

  if (creating || !hasAgent || !selected) {
    return (
      <div className="space-y-6">
        <SetupPanel
          addingAnother={agents.length > 0}
          onCancel={
            agents.length > 0
              ? () => {
                  setCreating(false);
                  if (!selectedMint && agents[0]?.mint) selectAgent(agents[0].mint);
                }
              : undefined
          }
          onCreated={() => {
            setCreating(false);
            void mutate();
          }}
        />
      </div>
    );
  }

  const network = selected.network ?? SOLANA_NETWORK;
  const budget = selected.budget ?? {};

  return (
    <div className="space-y-6">
      <AgentSelector
        agents={agents}
        selectedMint={selected.mint}
        onSelect={selectAgent}
        onCreate={() => setCreating(true)}
      />

      {/* Header card */}
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {selected.image_url ? (
              <img
                src={selected.image_url}
                alt=""
                className="size-12 sm:size-14 rounded-xl border border-border object-cover shrink-0"
              />
            ) : null}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-semibold tracking-tight truncate">
                  {selected.name ?? 'Untitled agent'}
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-success">
                  <CheckCircle2Icon className="size-3" />
                  Active
                </span>
              </div>
              {selected.description ? (
                <p className="text-xs text-fg-muted mt-1.5">{selected.description}</p>
              ) : null}
              <p className="text-[11px] text-fg-subtle mt-1 font-mono">network · {network}</p>
            </div>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/agents">
              Open chat
              <ArrowUpRightIcon className="size-3.5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Agent identity */}
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Agent identity</h3>
          <p className="text-xs text-fg-muted mt-0.5">
            The MPL-Core identity and stablecoin treasury for this agent.
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <FieldRow
            label="Agent mint"
            value={selected.mint!}
            href={explorerUrl(selected.mint!, network)}
          />
          <FieldRow
            label="Treasury"
            value={selected.treasury ?? ''}
            href={selected.treasury ? explorerUrl(selected.treasury, network) : undefined}
          />
        </dl>
      </section>

      {/* Treasury balance + withdraw */}
      <TreasuryPanel agentMint={selected.mint!} ownerWallet={wallet} />

      {/* Treasury & spend caps */}
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Treasury &amp; spend</h3>
            <p className="text-xs text-fg-muted mt-0.5">
              Daily, per-task, and per-action USDC caps enforced by the facilitator.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/profile/spend">
              <WalletIcon className="size-3.5" />
              Edit caps
            </Link>
          </Button>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <BudgetRow label="Per action" value={formatUsdc(budget.per_action)} />
          <BudgetRow label="Per task" value={formatUsdc(budget.per_task)} />
          <BudgetRow label="Per day" value={formatUsdc(budget.per_day)} />
        </dl>
      </section>

      {/* Delegate executor */}
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <ShieldIcon className="size-3.5 text-brand-strong" />
            Delegate executor
          </h3>
          <p className="text-xs text-fg-muted mt-0.5 max-w-prose">
            The wallet authorised to spend from the treasury on the agent&apos;s behalf. By default
            this is your own owner wallet.
          </p>
        </div>
        <FieldRow label="Executive wallet" value={wallet} compact />
        <p className="text-[11px] text-fg-subtle">
          Rotating the executor signs a new spend-delegation transaction. Coming soon.
        </p>
      </section>
    </div>
  );
}

function AgentSelector({
  agents,
  selectedMint,
  onSelect,
  onCreate,
}: {
  agents: AgentItem[];
  selectedMint?: string | null;
  onSelect: (mint: string) => void;
  onCreate: () => void;
}) {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(agents.length / AGENTS_PER_PAGE));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * AGENTS_PER_PAGE;
  const visible = agents.slice(start, start + AGENTS_PER_PAGE);

  React.useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  React.useEffect(() => {
    const index = agents.findIndex((agent) => agent.mint === selectedMint);
    if (index >= 0) setPage(Math.floor(index / AGENTS_PER_PAGE) + 1);
  }, [agents, selectedMint]);

  return (
    <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Your agents</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Select the agent to inspect, fund, or configure. You can mint another agent at any time.
          </p>
        </div>
        <Button type="button" size="sm" onClick={onCreate}>
          <PlusIcon className="size-3.5" />
          New agent
        </Button>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {visible.map((agent) => {
          const mint = agent.mint ?? '';
          const active = Boolean(mint && mint === selectedMint);
          return (
            <button
              key={mint || agent.name || 'agent'}
              type="button"
              disabled={!mint}
              onClick={() => {
                if (mint) onSelect(mint);
              }}
              className={`rounded-lg border px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev ${
                active
                  ? 'border-brand/60 bg-brand/10 shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.35)]'
                  : 'border-border bg-bg/40 hover:border-border-strong hover:bg-bg-elev'
              }`}
              aria-pressed={active}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">
                    {agent.name ?? 'Untitled agent'}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-fg-subtle">
                    {shortAddress(agent.mint)}
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] uppercase tracking-widest text-fg-subtle">
                  {networkLabel(agent.network)}
                </span>
              </div>
              {agent.description ? (
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-muted">
                  {agent.description}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50 hover:border-border-strong"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={clampedPage <= 1}
          >
            Prev
          </button>
          <span className="px-2 text-xs text-fg-muted">
            {clampedPage} / {totalPages}
          </span>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50 hover:border-border-strong"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={clampedPage >= totalPages}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}

function FieldRow({
  label,
  value,
  href,
  compact = false,
}: {
  label: string;
  value: string;
  href?: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-border/60 bg-bg/40 ${compact ? 'p-2.5' : 'p-3'}`}>
      <div className="text-[11px] uppercase tracking-widest text-fg-subtle mb-1">{label}</div>
      <div
        className="font-mono text-[11px] sm:text-xs text-fg leading-snug select-all break-all"
        title={value}
      >
        {value || '—'}
      </div>
      {value ? (
        <div className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => copyToClipboard(value, `${label} copied`)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-fg-subtle hover:bg-bg-elev-2 hover:text-fg border border-transparent hover:border-border transition-colors"
            aria-label={`Copy ${label}`}
          >
            <CopyIcon className="size-3" />
            Copy
          </button>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-fg-subtle hover:bg-bg-elev-2 hover:text-fg border border-transparent hover:border-border transition-colors"
              aria-label="Open in explorer"
            >
              <ExternalLinkIcon className="size-3" />
              Explorer
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BudgetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
      <div className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</div>
      <div className="mt-1 text-sm font-mono">
        {value} <span className="text-fg-subtle">USDC</span>
      </div>
    </div>
  );
}

function SetupPanel({
  addingAnother = false,
  onCancel,
  onCreated,
}: {
  addingAnother?: boolean;
  onCancel?: () => void;
  onCreated: () => void;
}) {
  // explorer var only used to silence unused-import lint check on production builds
  void NEXT_PUBLIC_EXPLORER_URL;
  return (
    <div className="space-y-4">
      {addingAnother ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Create another agent</h2>
            <p className="mt-1 text-xs text-fg-muted">
              Mint a separate MPL-Core identity with its own treasury, services, and spend controls.
            </p>
          </div>
          {onCancel ? (
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Back to agents
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-xl border border-warning/40 bg-warning/8 p-4 sm:p-5 flex items-start gap-3">
        <AlertTriangleIcon className="size-5 shrink-0 text-warning mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-fg">
            {addingAnother ? 'Create a new on-chain agent.' : "You haven't set up your agent yet."}
          </p>
          <p className="text-fg-muted text-xs mt-1">
            {addingAnother
              ? 'Each agent gets its own treasury and network-scoped identity. Setup signs ~3 transactions: mint, provision USDC/USDT/USDG ATAs, and spend delegation.'
              : 'Until you mint an agent, chats run without a treasury — payments and marketplace tools are disabled. Setup signs ~3 transactions: mint, provision USDC/USDT/USDG ATAs, and spend delegation.'}
          </p>
        </div>
      </div>
      <OnboardingGate onDone={onCreated} />
    </div>
  );
}

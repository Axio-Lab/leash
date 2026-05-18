'use client';

import * as React from 'react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';
import { toast } from 'sonner';
import { AlertTriangleIcon, CheckCircle2Icon, CopyIcon, MailIcon, WalletIcon } from 'lucide-react';

import { Spinner } from '@/components/ui/spinner';
import {
  ACTIVE_AGENT_EVENT,
  ACTIVE_AGENT_STORAGE_KEY,
  getStoredActiveAgentMint,
} from '@/lib/active-agent';

type AgentItem = {
  mint?: string;
  treasury?: string;
  name?: string;
  network?: string;
};

const agentsFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ items: AgentItem[]; warning?: string }>;
};

function copy(value: string | undefined, label = 'Copied') {
  if (!value) return;
  void navigator.clipboard?.writeText(value);
  toast.success(label, { description: value });
}

export default function ProfileOverviewPage() {
  const { user } = usePrivy();
  const [activeMint, setActiveMint] = React.useState<string | null>(null);

  type Account = {
    type?: string;
    chainType?: string;
    address?: string;
    email?: { address?: string };
  };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solanaWallet = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solanaWallet?.address ?? '';
  const email =
    user?.email?.address ?? accounts.find((a) => a.type === 'email')?.email?.address ?? null;

  const { data, isLoading } = useSWR<{ items: AgentItem[]; warning?: string }>(
    '/api/agents',
    agentsFetcher,
  );
  const agents = data?.items ?? [];
  const primary = agents.find((agent) => agent.mint === activeMint) ?? agents[0] ?? null;
  const hasAgent = Boolean(primary?.mint);

  React.useEffect(() => {
    setActiveMint(getStoredActiveAgentMint());

    function onActiveAgent(e: Event) {
      setActiveMint((e as CustomEvent<string | null>).detail ?? null);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === ACTIVE_AGENT_STORAGE_KEY) setActiveMint(e.newValue);
    }
    window.addEventListener(ACTIVE_AGENT_EVENT, onActiveAgent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ACTIVE_AGENT_EVENT, onActiveAgent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Identity card */}
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Identity</h2>
            <p className="text-xs text-fg-muted mt-0.5">
              The Privy login that owns this workspace and signs every on-chain action.
            </p>
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
            <dt className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-fg-subtle">
              <WalletIcon className="size-3.5" /> Owner wallet
            </dt>
            <dd className="mt-1.5 flex items-center justify-between gap-2 text-sm font-mono">
              <span className="break-all text-[11px] sm:text-xs">{wallet || 'Not linked'}</span>
              {wallet ? (
                <button
                  type="button"
                  onClick={() => copy(wallet, 'Wallet address copied')}
                  className="shrink-0 rounded-md p-1.5 text-fg-subtle hover:bg-bg-elev-2 hover:text-fg"
                  aria-label="Copy wallet address"
                >
                  <CopyIcon className="size-3.5" />
                </button>
              ) : null}
            </dd>
          </div>
          <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
            <dt className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-fg-subtle">
              <MailIcon className="size-3.5" /> Email
            </dt>
            <dd className="mt-1.5 text-sm truncate">
              {email ?? <span className="text-fg-subtle italic">Not linked</span>}
            </dd>
          </div>
        </dl>
      </section>

      {/* Agent status card */}
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">On-chain agent</h2>
            <p className="text-xs text-fg-muted mt-0.5">
              The MPL-Core asset, stablecoin treasury, and spend delegation that power your chats.
            </p>
          </div>
          {isLoading ? (
            <Spinner size="sm" />
          ) : hasAgent ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-success">
              <CheckCircle2Icon className="size-3" />
              Active
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-warning">
              <AlertTriangleIcon className="size-3" />
              Not set up
            </span>
          )}
        </div>

        {!isLoading && hasAgent && primary ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-widest text-fg-subtle">Agent</div>
                <div className="mt-1 truncate text-sm font-medium text-fg">
                  {primary.name ?? 'Untitled agent'}
                </div>
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="Network" value={primary.network ?? '—'} mono />
              <Field label="Mint" value={primary.mint ?? '—'} fullValue={primary.mint} mono />
              <Field
                label="Treasury"
                value={primary.treasury ?? '—'}
                fullValue={primary.treasury}
                mono
              />
            </dl>
          </div>
        ) : null}

        {!isLoading && !hasAgent ? (
          <p className="mt-4 text-xs text-fg-subtle">
            Mint an agent from the Agent tab to unlock treasury spend and marketplace tools.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  fullValue,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  fullValue?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
      <dt className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</dt>
      <dd className="mt-1 flex items-center justify-between gap-2 text-sm">
        <span className={`${mono ? 'font-mono text-[11px] sm:text-xs break-all' : ''}`}>
          {value}
        </span>
        {fullValue ? (
          <button
            type="button"
            onClick={() => copy(fullValue, `${label} copied`)}
            className="shrink-0 rounded-md p-1.5 text-fg-subtle hover:bg-bg-elev-2 hover:text-fg"
            aria-label={`Copy ${label}`}
          >
            <CopyIcon className="size-3.5" />
          </button>
        ) : null}
      </dd>
    </div>
  );
}

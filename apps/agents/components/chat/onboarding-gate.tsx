'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import { applySetField, DEFAULT_DRAFT, isDraftComplete, type AgentDraft } from '@/lib/agent-helper';
import { LEASH_AGENT_MODEL, SOLANA_NETWORK, SOLANA_RPC } from '@/lib/env';
import { mintAgentBrowserSide } from '@/lib/mint-agent';
import { provisionTreasuryAndDelegate } from '@/lib/onboarding';
import { usePrivyUmi } from '@/lib/use-privy-umi';

const SKIP_KEY = 'leash:onboarding_skipped';

function skipStorageKey(privyId: string): string {
  return `${SKIP_KEY}:${privyId}`;
}

export function readOnboardingSkipped(privyId: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(skipStorageKey(privyId)) === '1';
}

export function OnboardingGate({
  fullPage = false,
  onDone,
}: {
  fullPage?: boolean;
  onDone?: () => void;
}) {
  const { user } = usePrivy();
  const { umi, wallet, ready } = usePrivyUmi();
  const router = useRouter();
  const [draft, setDraft] = React.useState<AgentDraft>(DEFAULT_DRAFT);
  const [step, setStep] = React.useState<'form' | 'working' | 'done'>('form');
  const [progress, setProgress] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [solBalance, setSolBalance] = React.useState<number | null>(null);

  const privyId = user?.id ?? '';

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!wallet?.address) return;
      try {
        const conn = new Connection(SOLANA_RPC, 'confirmed');
        const lamports = await conn.getBalance(new PublicKey(wallet.address));
        if (!cancelled) setSolBalance(lamports / LAMPORTS_PER_SOL);
      } catch {
        if (!cancelled) setSolBalance(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [wallet?.address]);

  function setField(path: string, value: unknown) {
    setDraft((d) => applySetField(d, path, value));
  }

  async function onMint() {
    if (!umi || !wallet?.address || !isDraftComplete(draft)) {
      setError(!wallet ? 'Connect a Solana wallet first.' : 'Add a name and description.');
      return;
    }
    setError(null);
    setStep('working');
    try {
      setProgress('Minting agent on Solana…');
      const minted = await mintAgentBrowserSide({
        umi,
        wallet: wallet.address,
        name: draft.name.trim(),
        description: draft.description.trim(),
        network: SOLANA_NETWORK,
      });
      setProgress('Provisioning treasury & spend delegation…');
      await provisionTreasuryAndDelegate({
        umi,
        agentMint: minted.mint,
        executiveWallet: wallet.address,
        network: SOLANA_NETWORK,
        onProgress: setProgress,
      });
      setProgress('Saving agent…');
      const systemPrompt = `You are ${draft.name.trim()}. ${draft.description.trim()}`;
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mint: minted.mint,
          treasury: minted.treasury,
          name: draft.name.trim(),
          description: draft.description.trim(),
          network: SOLANA_NETWORK,
          model: LEASH_AGENT_MODEL,
          system_prompt: systemPrompt,
          capabilities: [],
          budget: { per_action: '10', per_task: '50', per_day: '100' },
          llm_provider: 'platform',
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      setStep('done');
      onDone?.();
      setTimeout(() => router.push('/agents'), fullPage ? 1200 : 800);
    } catch (e) {
      setError((e as Error).message);
      setStep('form');
    } finally {
      setProgress(null);
    }
  }

  function onSkip() {
    if (privyId) localStorage.setItem(skipStorageKey(privyId), '1');
    onDone?.();
    router.push('/agents');
  }

  const lowSol = solBalance !== null && solBalance < 0.05 && SOLANA_NETWORK === 'solana-devnet';

  const wrapCls = fullPage ? 'min-h-dvh flex items-center justify-center p-6' : '';

  return (
    <div className={wrapCls}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg-elev p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Create your on-chain agent</h2>
          <p className="text-sm text-fg-muted mt-1">
            Network: <span className="font-mono">{SOLANA_NETWORK}</span>
          </p>
        </div>
        {lowSol ? (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/25 px-3 py-2 text-xs text-amber-200">
            Low SOL ({solBalance?.toFixed(4)}). Fund devnet from a faucet so mint + ATA txs succeed.
            <a
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noreferrer"
              className="ml-2 underline"
            >
              faucet.solana.com
            </a>
          </div>
        ) : null}
        {step === 'form' ? (
          <>
            <label className="block text-sm">
              <span className="text-fg-muted">Name</span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. Ops Copilot"
              />
            </label>
            <label className="block text-sm">
              <span className="text-fg-muted">Description</span>
              <textarea
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
                rows={3}
                value={draft.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="What should this agent optimize for?"
              />
            </label>
            {error ? <div className="text-danger text-xs">{error}</div> : null}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={!ready || !isDraftComplete(draft)}
                onClick={() => void onMint()}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50"
              >
                Mint &amp; save
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="rounded-md border border-border px-4 py-2 text-sm hover:border-border-strong"
              >
                Skip for now
              </button>
            </div>
          </>
        ) : step === 'working' ? (
          <div className="py-8 text-center text-sm text-fg-muted">{progress ?? 'Working…'}</div>
        ) : (
          <div className="py-8 text-center text-sm text-success">Saved. Redirecting…</div>
        )}
        <p className="text-xs text-fg-subtle">
          Signs ~3 transactions: mint, provision USDC ATA, spend delegation. Chat uses the platform
          Claude key — add your own later under Settings → LLM.
        </p>
      </div>
    </div>
  );
}

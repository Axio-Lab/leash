'use client';

import { use, useState } from 'react';
import useSWR from 'swr';

type Agent = { mint: string; name: string; treasury: string; network: string };

const json = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export default function FundAgentPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const { data } = useSWR<{ items: Agent[] }>('/api/agents', json);
  const agent = data?.items.find((a) => a.mint === mint) ?? null;
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fund treasury</h1>
        <p className="text-fg-muted text-sm mt-1">
          Send USDC to your agent's Asset Signer PDA. The runtime spends from this address.
        </p>
      </div>
      {agent ? (
        <div className="rounded-lg border bg-bg-elev p-5 space-y-3">
          <div className="text-sm text-fg-muted">Treasury (Asset Signer PDA)</div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm break-all">{agent.treasury}</code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(agent.treasury);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* user can select manually */
                }
              }}
              className="rounded-md border px-2 py-1 text-xs hover:border-border-strong"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="text-xs text-fg-muted">
            Use any wallet to transfer USDC ({agent.network} mint:{' '}
            <code className="font-mono">
              {agent.network === 'solana-devnet'
                ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
                : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}
            </code>
            ).
          </div>
          <p className="text-xs text-fg-subtle">
            Phase 1: paste the address above. The wallet-bound transfer flow lands in Phase 3
            polish.
          </p>
        </div>
      ) : (
        <div className="text-fg-muted text-sm">Loading agent…</div>
      )}
    </div>
  );
}

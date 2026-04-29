'use client';

import * as React from 'react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

import { cn } from '@/lib/cn';
import { privyAuthedFetch } from '@/lib/privy-fetch';

export type ApiKeyItem = {
  id: string;
  label: string;
  name: string;
  network: 'solana-devnet' | 'solana-mainnet';
  prefix: string;
  last4: string;
  scopes: string[];
  created_at: string;
  disabled_at: string | null;
};

export function ApiKeysTable({ onCreate }: { onCreate: () => void }) {
  const { getAccessToken } = usePrivy();
  const fetcher = React.useCallback(
    async (url: string): Promise<{ items: ApiKeyItem[] }> => {
      // Privy sometimes resolves `getAccessToken` a tick after `authenticated`; retry 401 once.
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await privyAuthedFetch(getAccessToken, url);
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as { items: ApiKeyItem[] };
        if (res.status !== 401 || attempt === 2) {
          let extra = '';
          try {
            const j = JSON.parse(text) as { debug?: { hint?: string } };
            if (j.debug?.hint) extra = ` — ${j.debug.hint}`;
          } catch {
            /* ignore */
          }
          throw new Error(`HTTP ${res.status}${extra}`);
        }
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
      }
      throw new Error('HTTP 401');
    },
    [getAccessToken],
  );
  const { data, error, isLoading, mutate } = useSWR<{ items: ApiKeyItem[] }>('/api/keys', fetcher);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      const res = await privyAuthedFetch(getAccessToken, `/api/keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mutate();
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="rounded-lg border bg-bg-elev">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <div className="font-medium">API keys</div>
          <div className="text-xs text-fg-muted">
            Use these to call Leash from your scripts and listing tooling.
          </div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
        >
          + Create key
        </button>
      </div>
      {isLoading ? (
        <div className="px-4 py-8 text-fg-muted text-sm">Loading…</div>
      ) : error ? (
        <div className="px-4 py-8 text-danger text-sm">{(error as Error).message}</div>
      ) : !data || data.items.length === 0 ? (
        <div className="px-4 py-10 text-fg-muted text-sm text-center">
          No keys yet. Click <span className="text-fg">Create key</span> to issue one.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-fg-muted uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Key</th>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Network</th>
              <th className="text-left px-4 py-2">Scopes</th>
              <th className="text-left px-4 py-2">Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((k) => (
              <tr key={k.id} className="border-t">
                <td className="px-4 py-3 font-mono">
                  {k.prefix}…{k.last4}
                </td>
                <td className="px-4 py-3">{k.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      k.network === 'solana-devnet'
                        ? 'bg-amber-950/40 text-amber-300'
                        : 'bg-emerald-950/40 text-emerald-300',
                    )}
                  >
                    {k.network === 'solana-devnet' ? 'Devnet' : 'Mainnet'}
                  </span>
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {k.scopes.length > 0 ? k.scopes.join(', ') : '—'}
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {new Date(k.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {k.disabled_at ? (
                    <span className="text-xs text-fg-subtle">revoked</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => revoke(k.id)}
                      disabled={revokingId === k.id}
                      className="text-xs text-danger hover:underline disabled:opacity-60"
                    >
                      {revokingId === k.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

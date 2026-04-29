'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { usePrivy } from '@privy-io/react-auth';
import { CopyIcon, EyeIcon } from 'lucide-react';

import { Spinner } from '@/components/ui/spinner';
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

class ApiKeysFetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiKeysFetchError';
  }
}

export function ApiKeysTable({ onCreate }: { onCreate: () => void }) {
  const { getAccessToken } = usePrivy();
  const fetcher = React.useCallback(
    async (url: string): Promise<{ items: ApiKeyItem[] }> => {
      // Privy sometimes resolves `getAccessToken` a tick after `authenticated`; retry 401 once.
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await privyAuthedFetch(getAccessToken, url);
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as { items: ApiKeyItem[] };
        // Don't keep retrying on a 409 (recoverable, see WalletGate) — surface immediately.
        const isRetryable = res.status === 401 && attempt < 2;
        if (!isRetryable) {
          let hint = '';
          let code: string | undefined;
          try {
            const j = JSON.parse(text) as { error?: string; hint?: string };
            if (j.hint) hint = j.hint;
            if (j.error) code = j.error;
          } catch {
            /* ignore */
          }
          throw new ApiKeysFetchError(
            hint ? `HTTP ${res.status} — ${hint}` : `HTTP ${res.status}`,
            res.status,
            code,
          );
        }
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
      }
      throw new ApiKeysFetchError('HTTP 401', 401);
    },
    [getAccessToken],
  );
  const { data, error, isLoading, mutate } = useSWR<{ items: ApiKeyItem[] }>('/api/keys', fetcher);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = React.useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = React.useState<string | null>(null);

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

  async function reveal(id: string) {
    if (revealedKeys[id]) {
      setRevealedKeys((m) => {
        const { [id]: _drop, ...rest } = m;
        return rest;
      });
      return;
    }
    setRevealingId(id);
    try {
      const res = await privyAuthedFetch(
        getAccessToken,
        `/api/keys/${encodeURIComponent(id)}/reveal`,
      );
      const j = (await res.json().catch(() => ({}))) as {
        plaintext?: string;
        message?: string;
      };
      if (!res.ok || !j.plaintext) {
        toast.error('Could not reveal key', {
          description:
            j.message ??
            (res.status === 400 ? 'Issued before reveal was supported.' : `HTTP ${res.status}`),
        });
        return;
      }
      setRevealedKeys((m) => ({ ...m, [id]: j.plaintext! }));
    } catch (e) {
      toast.error('Could not reveal key', {
        description: e instanceof Error ? e.message : 'unknown',
      });
    } finally {
      setRevealingId(null);
    }
  }

  function copyKey(value: string) {
    void navigator.clipboard?.writeText(value);
    toast.success('Key copied');
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
        <div className="px-4 py-8 flex items-center gap-2 text-fg-muted text-sm">
          <Spinner size="sm" /> Loading keys
        </div>
      ) : error ? (
        <ApiKeyError error={error as Error} onRetry={() => mutate()} />
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
                  {revealedKeys[k.id] ? (
                    <div className="flex items-center gap-1.5">
                      <span className="break-all max-w-[260px] text-xs">{revealedKeys[k.id]}</span>
                      <button
                        type="button"
                        onClick={() => copyKey(revealedKeys[k.id]!)}
                        className="shrink-0 rounded-md p-1 text-fg-subtle hover:bg-bg-elev hover:text-fg"
                        aria-label="Copy key"
                      >
                        <CopyIcon className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span>
                        {k.prefix}…{k.last4}
                      </span>
                      <button
                        type="button"
                        onClick={() => void reveal(k.id)}
                        disabled={revealingId === k.id || !!k.disabled_at}
                        className="shrink-0 rounded-md p-1 text-fg-subtle hover:bg-bg-elev hover:text-fg disabled:opacity-40"
                        title="Reveal full key"
                        aria-label="Reveal full key"
                      >
                        {revealingId === k.id ? (
                          <Spinner size="xs" />
                        ) : (
                          <EyeIcon className="size-3" />
                        )}
                      </button>
                    </div>
                  )}
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

function ApiKeyError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const code = error instanceof ApiKeysFetchError ? error.code : undefined;
  if (code === 'no_solana_wallet') {
    return (
      <div className="px-4 py-6 text-sm space-y-3">
        <div className="font-medium text-fg">Connect a Solana wallet first.</div>
        <p className="text-fg-muted">
          API keys belong to a wallet so we can route fees and per-call earnings to you. Use the
          prompt at the top of the dashboard to connect a Solana wallet, then come back here.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
        >
          I&apos;ve connected — retry
        </button>
      </div>
    );
  }
  return (
    <div className="px-4 py-8 text-sm space-y-3">
      <div className="text-danger">{error.message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
      >
        Retry
      </button>
    </div>
  );
}

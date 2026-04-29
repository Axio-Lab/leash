'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { AlertTriangleIcon, CopyIcon, EyeIcon } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/spinner';

export type ApiKeyItem = {
  id: string;
  label: string;
  name: string;
  source?: 'agents' | 'marketplace' | 'shared' | 'unknown';
  network: 'solana-devnet' | 'solana-mainnet';
  prefix: string;
  last4: string;
  scopes: string[];
  created_at: string;
  disabled_at: string | null;
  /** Set when apps/api was unreachable and data is from local DB only. */
  _offline?: boolean;
};

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { items: ApiKeyItem[]; warning?: string };
};

export function ApiKeysTable({ onCreate }: { onCreate: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<{
    items: ApiKeyItem[];
    warning?: string;
  }>('/api/keys', fetcher);

  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = React.useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = React.useState<string | null>(null);
  const offline = data?.items.some((k) => k._offline);

  async function reveal(id: string) {
    if (revealedKeys[id]) {
      setRevealedKeys((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealingId(id);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}/reveal`, {
        credentials: 'include',
      });
      const j = (await res.json().catch(() => ({}))) as {
        plaintext?: string;
        message?: string;
      };
      if (!res.ok || !j.plaintext) {
        toast.error('Could not reveal key', {
          description:
            j.message ??
            (res.status === 400
              ? 'This key was issued before reveal was supported.'
              : `HTTP ${res.status}`),
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

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mutate();
      toast.success('Key revoked');
    } catch (e) {
      toast.error('Could not revoke key', {
        description: e instanceof Error ? e.message : 'unknown error',
      });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-elev overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="font-medium text-sm">API keys</div>
          <div className="text-xs text-fg-muted mt-0.5">
            Use these to call Leash from your scripts and the agent runtime.
          </div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
        >
          + Create
        </button>
      </div>

      {/* Offline warning banner */}
      {(offline || data?.warning) && (
        <div className="flex items-start gap-2.5 border-b border-warning/30 bg-warning/8 px-4 py-3 text-xs text-warning">
          <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
          <span>
            <strong>API service offline.</strong> Key details are limited — start{' '}
            <code className="font-mono">apps/api</code> and{' '}
            <code className="font-mono">apps/agents</code> in the same process to see full key info
            and manage keys. Keys below were issued and stored locally.
          </span>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="px-4 py-8 flex items-center gap-2 text-fg-muted text-sm">
          <Spinner size="sm" /> Loading keys
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-danger text-sm">{(error as Error).message}</div>
      ) : !data || data.items.length === 0 ? (
        <div className="px-4 py-10 text-fg-muted text-sm text-center space-y-1">
          <p>No keys yet.</p>
          <p className="text-xs">
            Keys created in{' '}
            <a
              href="http://localhost:4200/creator/settings/api-keys"
              className="text-brand hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              leash.market
            </a>{' '}
            also appear here once <code className="font-mono text-[10px]">apps/api</code> is
            running.
          </p>
        </div>
      ) : (
        /* Horizontally scrollable on mobile */
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-fg-muted uppercase tracking-wide bg-bg-elev/50">
              <tr>
                <th className="text-left px-4 py-2">Key</th>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Source</th>
                <th className="text-left px-4 py-2">Network</th>
                <th className="text-left px-4 py-2">Scopes</th>
                <th className="text-left px-4 py-2">Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((k) => (
                <tr
                  key={k.id}
                  className="border-t border-border hover:bg-bg-elev/50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">
                    {k._offline ? (
                      <span className="text-fg-subtle italic">limited info</span>
                    ) : revealedKeys[k.id] ? (
                      <div className="flex items-center gap-1.5">
                        <span className="break-all max-w-[260px]">{revealedKeys[k.id]}</span>
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
                        k.source === 'agents'
                          ? 'bg-brand/20 text-brand'
                          : k.source === 'marketplace'
                            ? 'bg-violet-950/40 text-violet-300'
                            : k.source === 'shared'
                              ? 'bg-sky-950/40 text-sky-300'
                              : 'bg-bg text-fg-subtle',
                      )}
                    >
                      {k.source ?? 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {k._offline ? (
                      <span className="text-fg-subtle text-xs italic">—</span>
                    ) : (
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
                    )}
                  </td>
                  <td className="px-4 py-3 text-fg-muted text-xs">
                    {k.scopes.length > 0 ? k.scopes.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-fg-muted text-xs">
                    {k._offline ? '—' : new Date(k.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {k._offline ? null : k.disabled_at ? (
                      <span className="text-xs text-fg-subtle">revoked</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => revoke(k.id)}
                        disabled={revokingId === k.id}
                        className="inline-flex items-center gap-1.5 text-xs text-danger hover:underline disabled:opacity-60"
                      >
                        {revokingId === k.id ? (
                          <>
                            <Spinner size="xs" /> Revoking
                          </>
                        ) : (
                          'Revoke'
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

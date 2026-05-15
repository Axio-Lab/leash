'use client';

import * as React from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { privyAuthedFetch } from '@/lib/privy-fetch';

export type CreatedKey = {
  id: string;
  prefix: string;
  last4: string;
  plaintext: string;
};

export function CreateKeyDialog({
  open,
  onClose,
  onCreated,
  defaultScopes = ['marketplace'],
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (k: CreatedKey) => void;
  defaultScopes?: string[];
}) {
  const { getAccessToken } = usePrivy();
  const [name, setName] = React.useState('');
  const [network, setNetwork] = React.useState<'solana-devnet' | 'solana-mainnet'>('solana-devnet');
  const [scopes, setScopes] = React.useState<string[]>(defaultScopes);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setNetwork('solana-devnet');
      setScopes(defaultScopes);
      setError(null);
    }
  }, [open, defaultScopes]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await privyAuthedFetch(getAccessToken, '/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), network, scopes }),
      });
      const body = (await res.json()) as
        | { key: { id: string; prefix: string; last4: string }; plaintext: string }
        | { error: string; message?: string };
      if (!res.ok || !('key' in body)) {
        const msg = 'message' in body && body.message ? body.message : 'failed to create key';
        throw new Error(msg);
      }
      onCreated({
        id: body.key.id,
        prefix: body.key.prefix,
        last4: body.key.last4,
        plaintext: body.plaintext,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border bg-bg-elev p-6 space-y-5 shadow-2xl"
      >
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Create API key</h2>
          <p className="mt-1 text-xs text-fg-muted">
            You&apos;ll see the full key right after creation. You can also reveal it later.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ci, prod, my-laptop…"
            required
            maxLength={120}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Network</Label>
          <div className="flex gap-2">
            {(['solana-devnet', 'solana-mainnet'] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNetwork(n)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-xs uppercase tracking-wide transition-colors',
                  network === n
                    ? 'border-brand bg-brand/15 text-brand-strong'
                    : 'border-border text-fg-muted hover:border-border-strong',
                )}
              >
                {n === 'solana-devnet' ? 'Devnet' : 'Mainnet'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Scopes</Label>
          <div className="flex flex-wrap gap-2">
            {(['agents', 'marketplace'] as const).map((s) => {
              const checked = scopes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setScopes((prev) => (checked ? prev.filter((x) => x !== s) : [...prev, s]))
                  }
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs uppercase tracking-wide transition-colors',
                    checked
                      ? 'border-brand bg-brand/15 text-brand-strong'
                      : 'border-border text-fg-muted hover:border-border-strong',
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {error ? <div className="text-xs text-danger">{error}</div> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting || name.trim().length === 0}>
            {submitting ? 'Creating…' : 'Create key'}
          </Button>
        </div>
      </form>
    </div>
  );
}

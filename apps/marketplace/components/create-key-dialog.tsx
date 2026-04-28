'use client';

import * as React from 'react';

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
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border bg-bg-elev p-5 space-y-4"
      >
        <div>
          <h2 className="text-base font-medium">Create API key</h2>
          <p className="text-xs text-fg-muted mt-1">
            The plaintext value is shown once after creation. Copy it then.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-fg-muted text-xs">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ci"
            required
            maxLength={120}
            className="mt-1 w-full rounded-md border bg-bg px-3 py-2"
          />
        </label>
        <fieldset className="text-sm">
          <legend className="text-fg-muted text-xs mb-1">Network</legend>
          <div className="flex gap-2">
            {(['solana-devnet', 'solana-mainnet'] as const).map((n) => (
              <label key={n} className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="network"
                  value={n}
                  checked={network === n}
                  onChange={() => setNetwork(n)}
                />
                {n === 'solana-devnet' ? 'Devnet' : 'Mainnet'}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="text-sm">
          <legend className="text-fg-muted text-xs mb-1">Scopes</legend>
          <div className="flex flex-wrap gap-3">
            {(['agents', 'marketplace'] as const).map((s) => (
              <label key={s} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) => {
                    setScopes((prev) =>
                      e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                    );
                  }}
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <div className="text-danger text-xs">{error}</div> : null}
        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:border-border-strong"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length === 0}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </form>
    </div>
  );
}

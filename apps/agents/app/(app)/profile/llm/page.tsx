'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export default function ProfileLlmPage() {
  const [status, setStatus] = React.useState<{ saved: boolean; last4?: string } | null>(null);
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/llm', { credentials: 'include' });
        const j = (await res.json().catch(() => ({}))) as { saved?: boolean; last4?: string };
        setStatus({ saved: !!j.saved, last4: j.last4 });
      } catch {
        setStatus({ saved: false });
      }
    })();
  }, []);

  async function test() {
    setHint(null);
    setBusy(true);
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const j = (await res.json()) as { ok?: boolean; reason?: string; models?: string[] };
      if (j.ok) {
        toast.success('Key works', { description: `${j.models?.length ?? 0} models visible` });
        setHint(`OK — ${j.models?.length ?? 0} models visible`);
      } else {
        toast.error('Key check failed', { description: j.reason });
        setHint(j.reason ?? 'failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setHint(null);
    setBusy(true);
    try {
      const res = await fetch('/api/llm', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        toast.error('Save failed', { description: `HTTP ${res.status}` });
        return;
      }
      const last4 = key.slice(-4);
      setKey('');
      setStatus({ saved: true, last4 });
      toast.success('Saved', { description: 'Future turns bill your Anthropic key.' });
      setHint('Saved. Future turns bill your Anthropic key.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch('/api/llm', { method: 'DELETE', credentials: 'include' });
      setStatus({ saved: false });
      toast.success('Removed', { description: 'Using Leash platform key again.' });
      setHint(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Anthropic key</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            We run Claude with the Leash platform key by default. Paste your own to bill your
            Anthropic account instead.
          </p>
        </div>

        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner size="sm" /> Checking key
          </div>
        ) : status.saved ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/8 px-4 py-3 text-sm">
            <span>
              Using your key (<span className="font-mono">…{status.last4}</span>)
            </span>
            <button
              type="button"
              className="text-xs text-danger hover:underline"
              onClick={() => void remove()}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-bg/40 px-4 py-3 text-sm text-fg-muted">
            Using Leash&apos;s platform key
          </div>
        )}

        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm font-mono focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || key.length < 20}
            onClick={() => void test()}
          >
            {busy ? <Spinner size="sm" /> : null}
            Test
          </Button>
          <Button
            type="button"
            disabled={busy || !key.startsWith('sk-ant-')}
            onClick={() => void save()}
          >
            {busy ? <Spinner size="sm" /> : null}
            Save
          </Button>
        </div>

        {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
      </section>
    </div>
  );
}

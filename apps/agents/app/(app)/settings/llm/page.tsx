'use client';

import * as React from 'react';

export default function LlmSettingsPage() {
  const [status, setStatus] = React.useState<{ saved: boolean; last4?: string } | null>(null);
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      const res = await fetch('/api/llm', { credentials: 'include' });
      const j = (await res.json().catch(() => ({}))) as { saved?: boolean; last4?: string };
      setStatus({ saved: !!j.saved, last4: j.last4 });
    })();
  }, []);

  async function test() {
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const j = (await res.json()) as { ok?: boolean; reason?: string; models?: string[] };
      if (j.ok) setMsg(`OK — ${j.models?.length ?? 0} models visible`);
      else setMsg(j.reason ?? 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/llm', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        setMsg('Save failed');
        return;
      }
      setKey('');
      setStatus({ saved: true, last4: key.slice(-4) });
      setMsg('Saved. Future turns bill your Anthropic key.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch('/api/llm', { method: 'DELETE', credentials: 'include' });
      setStatus({ saved: false });
      setMsg('Removed — using platform key again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <p className="text-sm text-fg-muted">
        We run Claude with Leash&apos;s key by default. Paste your own Anthropic key to use your
        account instead.
      </p>
      {status?.saved ? (
        <div className="rounded-lg border border-border bg-bg-elev px-4 py-3 text-sm">
          Using your key (…{status.last4})
          <button
            type="button"
            className="ml-3 text-danger hover:underline text-xs"
            onClick={() => void remove()}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg-elev px-4 py-3 text-sm">
          Using Leash&apos;s platform key
        </div>
      )}
      <input
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="sk-ant-…"
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm font-mono"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || key.length < 20}
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-bg-elev"
          onClick={() => void test()}
        >
          Test
        </button>
        <button
          type="button"
          disabled={busy || !key.startsWith('sk-ant-')}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50"
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
      {msg ? <p className="text-xs text-fg-muted">{msg}</p> : null}
    </div>
  );
}

'use client';

import Link from 'next/link';
import * as React from 'react';
import { ArrowLeftIcon, CheckIcon, SlidersHorizontalIcon, SparklesIcon, XIcon } from 'lucide-react';

import { AutomationDashboard } from '@/components/automation/automation-dashboard';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type AssistantResponse = {
  handled: boolean;
  text: string;
  pending_id?: string;
  automation_id?: string;
};

const examples = [
  'Create an automation that summarizes Gmail every weekday at 9am and keeps the report in history.',
  'When a receipt settles, send me a short report.',
  'Set up a webhook automation that reviews the payload and reports failures.',
];

export function AutomationPromptBuilder() {
  const [message, setMessage] = React.useState('');
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [response, setResponse] = React.useState<AssistantResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [advanced, setAdvanced] = React.useState(false);

  async function send(nextMessage: string, nextPendingId = pendingId) {
    const trimmed = nextMessage.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/automations/assistant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          pending_id: nextPendingId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.slice(0, 240) || `HTTP ${res.status}`);
      const json = JSON.parse(text) as AssistantResponse;
      setResponse(json);
      setPendingId(json.pending_id ?? null);
      if (json.automation_id) setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await send(message);
  }

  if (advanced) {
    return (
      <AutomationDashboard
        mode="form"
        onPromptMode={() => setAdvanced(false)}
        showFormEyebrow={false}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-border pb-4">
          <Link
            href="/agents/automation"
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            Automations
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">New automation</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">
              Tell the agent what should happen. It will draft the trigger, sources, caps, and
              report policy for review before anything is saved.
            </p>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-lg border border-border bg-bg-elev/70 p-4">
            <form onSubmit={submit} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-fg">
                  What should your agent automate?
                </span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Example: Summarize Gmail every weekday at 9am and send the report here."
                  rows={6}
                  className="w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm leading-6 text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/70"
                />
              </label>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button type="submit" disabled={busy || !message.trim()} className="min-h-10">
                  {busy ? <Spinner size="sm" /> : <SparklesIcon className="size-4" />}
                  Draft automation
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-10"
                  onClick={() => setAdvanced(true)}
                >
                  <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
                  Advanced settings
                </Button>
              </div>
            </form>

            {error ? (
              <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            ) : null}

            {response ? (
              <div className="mt-4 rounded-lg border border-border bg-bg p-4">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-fg">
                  {response.text}
                </pre>
                {pendingId ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busy}
                      className="min-h-10"
                      onClick={() => send('confirm', pendingId)}
                    >
                      <CheckIcon className="size-4" aria-hidden="true" />
                      Create automation
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      className="min-h-10"
                      onClick={() => send('cancel', pendingId)}
                    >
                      <XIcon className="size-4" aria-hidden="true" />
                      Cancel
                    </Button>
                  </div>
                ) : response.automation_id ? (
                  <Button asChild className="mt-4 min-h-10">
                    <Link href={`/agents/automation/${encodeURIComponent(response.automation_id)}`}>
                      Open automation
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside className="space-y-3">
            <div className="rounded-lg border border-border bg-bg p-4">
              <h2 className="text-sm font-medium">Try one</h2>
              <div className="mt-3 space-y-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setMessage(example)}
                    className="block w-full rounded-md border border-border bg-bg-elev px-3 py-2 text-left text-xs leading-5 text-fg-muted hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-bg p-4 text-xs leading-5 text-fg-muted">
              Every create, edit, or delete action is reviewed before saving. Connector-created
              automations report back to that chat by default; web-created automations keep reports
              in history unless you ask otherwise.
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

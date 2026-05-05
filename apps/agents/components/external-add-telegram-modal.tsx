'use client';

/**
 * Add-Telegram-connection modal.
 *
 * Single step: user pastes a BYO bot token + username (from @BotFather),
 * we POST `/api/external/connections`. apps/api encrypts the token, calls
 * Telegram `setWebhook`, and returns the new row.
 *
 * The modal closes immediately on success — pair link, webhook URL, and
 * **Refresh** live in the expandable row on the External settings table.
 */

import * as React from 'react';
import { CheckCircle2Icon, Loader2, PencilIcon, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export type ExternalConnection = {
  id: string;
  channel: 'telegram' | 'whatsapp';
  status: 'pending' | 'connected' | 'error' | 'revoked';
  display_name: string | null;
  bot_username: string | null;
  routing_id: string | null;
  verification_token: string | null;
  bound_chat_id: string | null;
  signing_mode: 'deep_link' | 'delegated';
  cap_per_tx: string | null;
  cap_per_day: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
  /** Present for channel=telegram — public webhook URL on the API host. */
  telegram_webhook_url?: string | null;
};

/**
 * BotFather tokens are `<bot_id>:<35-char-secret>` — we keep the regex
 * lenient (≥20 char tail, alphanumeric + `-`/`_`) so we don't reject
 * future formats but tight enough to avoid hammering getMe on every
 * keystroke while the user is mid-paste.
 */
function isLikelyTelegramToken(token: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token);
}

export function AddTelegramModal({
  open,
  onClose,
  onPaired,
}: {
  open: boolean;
  onClose: () => void;
  onPaired: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [displayName, setDisplayName] = React.useState('My Telegram');
  const [botToken, setBotToken] = React.useState('');
  const [botUsername, setBotUsername] = React.useState('');
  const [usernameLocked, setUsernameLocked] = React.useState(false);
  const [tokenLookup, setTokenLookup] = React.useState<{
    state: 'idle' | 'verifying' | 'ok' | 'fail';
    message?: string;
  }>({ state: 'idle' });

  React.useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setError(null);
    setDisplayName('My Telegram');
    setBotToken('');
    setBotUsername('');
    setUsernameLocked(false);
    setTokenLookup({ state: 'idle' });
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const trimmed = botToken.trim();
    if (!isLikelyTelegramToken(trimmed)) {
      setTokenLookup({ state: 'idle' });
      return;
    }
    setTokenLookup({ state: 'verifying' });
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${trimmed}/getMe`, {
          signal: ctrl.signal,
        });
        const json = (await res.json()) as {
          ok: boolean;
          description?: string;
          result?: { username?: string; first_name?: string };
        };
        if (!json.ok || !json.result?.username) {
          setTokenLookup({ state: 'fail', message: json.description || 'Token rejected' });
          return;
        }
        setBotUsername(json.result.username);
        setUsernameLocked(true);
        if (json.result.first_name && displayName === 'My Telegram') {
          setDisplayName(json.result.first_name);
        }
        setTokenLookup({ state: 'ok', message: `@${json.result.username}` });
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return;
        setTokenLookup({
          state: 'fail',
          message: 'Could not reach Telegram. Enter the @ manually.',
        });
      }
    }, 400);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [botToken, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/external/connections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'telegram',
          display_name: displayName.trim() || 'Telegram',
          bot_token: botToken.trim(),
          bot_username: botUsername.replace(/^@/, '').trim(),
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { message?: string; error?: string };
          message = j.message ?? j.error ?? message;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      const payload = JSON.parse(text) as {
        connection: ExternalConnection;
        telegram_webhook_registered?: boolean;
        telegram_webhook_error?: string | null;
      };

      if (payload.telegram_webhook_registered === false && payload.telegram_webhook_error) {
        toast.warning('Telegram connection saved', {
          description: `Webhook was not set: ${payload.telegram_webhook_error}. Fix LEASH_API_PUBLIC_ORIGIN or set the webhook from the connection details.`,
        });
      } else {
        toast.success('Telegram connection added', {
          description:
            'Webhook is configured. Expand the row to open your bot or copy the inbound URL.',
        });
      }

      onPaired();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elev shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-medium">Add Telegram</h2>
            <p className="text-xs text-fg-muted mt-0.5">
              Paste your bot token from @BotFather. We register the webhook for you — no curl.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-fg-subtle hover:bg-bg hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-4 py-4">
          <BotFatherHelp />

          <label className="block text-sm">
            <span className="text-fg-muted text-xs">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Telegram"
              maxLength={120}
              required
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-[11px] text-fg-subtle">
              Shown in your settings list. Pick whatever you&apos;ll recognise later.
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-fg-muted text-xs">Bot token</span>
            <div className="relative mt-1">
              <input
                type="password"
                value={botToken}
                onChange={(e) => {
                  setBotToken(e.target.value);
                  if (usernameLocked) {
                    setUsernameLocked(false);
                    setBotUsername('');
                  }
                }}
                placeholder="123456789:ABCdef-ghi_jklmnopqrstuvwxyz12345678"
                required
                minLength={20}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 pr-9 text-sm font-mono"
              />
              {tokenLookup.state === 'verifying' ? (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-fg-subtle" />
              ) : tokenLookup.state === 'ok' ? (
                <CheckCircle2Icon className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-success" />
              ) : null}
            </div>
            <span className="mt-1 block text-[11px] text-fg-subtle">
              Encrypted at rest. Never shown again — delete and re-add if you lose it.
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-fg-muted text-xs">Bot username</span>
            <div
              className={`mt-1 flex items-center gap-1 rounded-md border px-3 ${
                usernameLocked ? 'border-success/30 bg-success/5' : 'border-border bg-bg'
              }`}
            >
              <span className="text-fg-subtle text-sm">@</span>
              <input
                type="text"
                value={botUsername}
                onChange={(e) => setBotUsername(e.target.value.replace(/^@/, ''))}
                placeholder={tokenLookup.state === 'verifying' ? 'Looking up bot…' : 'my_leash_bot'}
                pattern="^[A-Za-z0-9_]{4,32}$"
                required
                readOnly={usernameLocked}
                className={`w-full bg-transparent py-2 text-sm focus:outline-none ${
                  usernameLocked ? 'text-success' : ''
                }`}
              />
              {usernameLocked ? (
                <button
                  type="button"
                  onClick={() => {
                    setUsernameLocked(false);
                    setTokenLookup({ state: 'idle' });
                  }}
                  className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg hover:text-fg"
                  aria-label="Edit username manually"
                  title="Edit manually"
                >
                  <PencilIcon className="size-3" />
                </button>
              ) : null}
            </div>
            <span className="mt-1 block text-[11px] text-fg-subtle">
              {usernameLocked ? (
                <span className="text-success/80">Auto-detected from your token.</span>
              ) : tokenLookup.state === 'fail' ? (
                <span className="text-warning">{tokenLookup.message}</span>
              ) : (
                <>Without the leading @. We&apos;ll auto-fill from your token when possible.</>
              )}
            </span>
          </label>

          {error ? (
            <div className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger wrap-break-word">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Adding
                </>
              ) : (
                'Add connection'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BotFatherHelp() {
  return (
    <details className="rounded-md border border-border bg-bg/50 px-3 py-2 text-xs text-fg-muted">
      <summary className="cursor-pointer text-fg select-none">How do I get a bot token?</summary>
      <ol className="mt-2 space-y-1 list-decimal list-inside leading-relaxed">
        <li>
          Open Telegram and chat with{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            @BotFather
          </a>
          .
        </li>
        <li>
          Send <code>/newbot</code>, pick a name, then a username ending in <code>bot</code>.
        </li>
        <li>
          BotFather replies with an <strong>HTTP API token</strong> — paste it below.
        </li>
      </ol>
    </details>
  );
}

'use client';

/**
 * Add-Telegram-connection modal.
 *
 * Two-step flow inside one dialog:
 *
 *   1. **Form** — user pastes their BYO bot token + username (created
 *      via @BotFather). We POST `/api/external/connections` with
 *      `channel='telegram'`. apps/api encrypts the token at rest, mints
 *      a verification token, and returns `{connection, deep_link,
 *      webhook_url}`.
 *
 *   2. **Pair** — we show a click-able `t.me/<bot>?start=<token>` link
 *      (no QR — that is only used for WhatsApp linked-device pairing), plus
 *      the webhook URL the user pastes into BotFather's `setWebhook` (or curls
 *      themselves).
 *      The page polls `GET /api/external/connections/{id}` once a
 *      second; the dot-status flips to "connected" the moment Telegram
 *      delivers the user's `/start <token>` message.
 *
 * The connection row is cancellable at any time — closing the modal
 * before pairing leaves it in `status='pending'`, and the user can
 * resume from the table or refresh the verification token.
 */

import * as React from 'react';
import {
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2,
  PencilIcon,
  ShieldCheckIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

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
};

type CreateResponse = {
  connection: ExternalConnection;
  webhook_url: string | null;
  deep_link: string | null;
};

type Phase = { kind: 'form' } | { kind: 'pair'; created: CreateResponse };

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
  const [phase, setPhase] = React.useState<Phase>({ kind: 'form' });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [displayName, setDisplayName] = React.useState('My Telegram');
  const [botToken, setBotToken] = React.useState('');
  const [botUsername, setBotUsername] = React.useState('');
  // Auto-lookup: when the token looks well-formed, hit Telegram's getMe
  // and pre-fill the bot username. Locked = pulled from getMe and read-only;
  // user can flip to manual edit if they want to override.
  const [usernameLocked, setUsernameLocked] = React.useState(false);
  const [tokenLookup, setTokenLookup] = React.useState<{
    state: 'idle' | 'verifying' | 'ok' | 'fail';
    message?: string;
  }>({ state: 'idle' });

  React.useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'form' });
    setSubmitting(false);
    setError(null);
    setDisplayName('My Telegram');
    setBotToken('');
    setBotUsername('');
    setUsernameLocked(false);
    setTokenLookup({ state: 'idle' });
  }, [open]);

  // Debounced getMe lookup — fires ~400ms after the user stops typing
  // a well-formed token. We don't surface the raw network call as a
  // hard error; if it fails, the username field stays editable and the
  // server will validate again on submit.
  React.useEffect(() => {
    if (phase.kind !== 'form') return;
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
    // displayName intentionally omitted — we only seed it once from
    // getMe; later edits shouldn't re-trigger the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botToken, phase.kind]);

  // Poll the connection while we're on the pair screen so the dialog
  // can flip to "Connected — you're done" without the user reloading.
  React.useEffect(() => {
    if (!open || phase.kind !== 'pair') return;
    let cancelled = false;
    const id = phase.created.connection.id;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch(`/api/external/connections/${encodeURIComponent(id)}`, {
          credentials: 'include',
        });
        if (!cancelled && res.ok) {
          const conn = (await res.json()) as ExternalConnection;
          if (conn.status === 'connected') {
            toast.success('Telegram connected', {
              description: `Bot ${conn.bot_username ? '@' + conn.bot_username : ''} is bound to your chat.`,
            });
            onPaired();
            onClose();
            return;
          }
          if (conn.status === 'error' && conn.error) {
            setError(conn.error);
          }
        }
      } catch {
        // Network blip — just retry next tick.
      }
      if (!cancelled) {
        timer = setTimeout(tick, 2_000);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, phase, onPaired, onClose]);

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
      const created = JSON.parse(text) as CreateResponse;
      setPhase({ kind: 'pair', created });
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
            <h2 className="text-base font-medium">
              {phase.kind === 'form' ? 'Connect Telegram' : 'Bind your chat'}
            </h2>
            <p className="text-xs text-fg-muted mt-0.5">
              {phase.kind === 'form'
                ? 'Bring your own bot token from @BotFather.'
                : 'Open the link in Telegram and tap Start — we link the first chat that does.'}
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

        {phase.kind === 'form' ? (
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
                Shown in your settings list. Pick whatever you'll recognise later.
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
                Encrypted at rest with AES-GCM. Never shown again — refresh the connection if you
                lose it.
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
                  placeholder={
                    tokenLookup.state === 'verifying' ? 'Looking up bot…' : 'my_leash_bot'
                  }
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
                  <>Without the leading @. We'll auto-fill this from your token.</>
                )}
              </span>
            </label>

            {error ? (
              <div className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger break-words">
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
                    Creating
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </div>
          </form>
        ) : (
          <PairPhase created={phase.created} error={error} />
        )}
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

function PairPhase({ created, error }: { created: CreateResponse; error: string | null }) {
  const deepLink = created.deep_link;
  const webhook = created.webhook_url;
  const conn = created.connection;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="rounded-md border border-brand/30 bg-brand/8 p-3 text-xs text-fg">
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
          <span>
            Your bot is registered. Now bind it to <em>your</em> Telegram chat so only you can talk
            to it. The link below is one-time and only works for the first chat that opens it.
          </span>
        </div>
      </div>

      {deepLink ? (
        <a
          href={deepLink}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-bg px-3 py-2 text-xs text-brand hover:underline"
        >
          <ExternalLinkIcon className="size-3.5 shrink-0" />
          <span className="font-mono break-all text-center">{deepLink}</span>
        </a>
      ) : null}

      {webhook ? (
        <details className="rounded-md border border-border bg-bg/50 px-3 py-2 text-xs">
          <summary className="cursor-pointer text-fg select-none">
            Set the bot webhook (one-time)
          </summary>
          <div className="mt-2 space-y-2 text-fg-muted">
            <p>
              Telegram needs to know where to deliver updates. Either run this once from any shell:
            </p>
            <CopyableLine
              text={`curl -s 'https://api.telegram.org/bot<token>/setWebhook' -d url='${webhook}'`}
            />
            <p>
              or paste the URL into BotFather → <em>Bot Settings</em> → <em>Webhook</em>.
            </p>
          </div>
        </details>
      ) : null}

      <div className="flex items-center gap-2 rounded-md border border-border bg-bg p-3 text-xs">
        <Spinner size="sm" />
        <span className="text-fg-muted">
          Waiting for your <code>/start</code> message
          {conn.bot_username ? (
            <>
              {' '}
              in <code>@{conn.bot_username}</code>
            </>
          ) : null}
          …
        </span>
      </div>

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger break-words">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function CopyableLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-bg px-2 py-1.5">
      <code className="flex-1 break-all font-mono text-[10.5px]">{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          toast.success('Copied');
        }}
        className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg-elev hover:text-fg"
        aria-label="Copy"
      >
        <CopyIcon className="size-3" />
      </button>
    </div>
  );
}

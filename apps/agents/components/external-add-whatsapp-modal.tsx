'use client';

/**
 * Add-WhatsApp-connection modal.
 *
 * Flow:
 *   1. User clicks "Add WhatsApp" → we POST `/api/external/connections`
 *      with `channel='whatsapp'`. apps/api creates a pending row and
 *      seeds an empty `external_whatsapp_state`.
 *   2. We POST `/api/external/whatsapp/{id}/start` to bring up the
 *      Baileys session. apps/api opens the WebSocket against
 *      WhatsApp Web — the first `connection.update` event carries a
 *      QR string we persist into `external_whatsapp_state.last_qr`.
 *   3. We poll `GET /api/external/whatsapp/{id}/qr` every ~2s. When
 *      `qr` is non-null we render it; when `status` flips to
 *      `connected` we close.
 *
 * Failure modes the UI surfaces:
 *   - 503 from `start` — operator hasn't enabled the WhatsApp bridge
 *     on this replica. We render a callout pointing at LEASH_WHATSAPP_ENABLED.
 *   - QR never arrives within 60s — likely a Baileys boot problem; we
 *     show the user the apps/api error from the connection row.
 *   - WhatsApp device unlinked after pairing → status flips to 'error'
 *     and the connection row carries `error` text we display verbatim.
 */

import * as React from 'react';
import { Loader2, ShieldCheckIcon, X, RefreshCcw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

import type { ExternalConnection } from './external-add-telegram-modal';

type CreateResponse = {
  connection: ExternalConnection;
  webhook_url: string | null;
  deep_link: string | null;
};

type QrPoll = {
  qr: string | null;
  qr_at: string | null;
  status: 'pending' | 'connected' | 'error' | 'revoked';
  me_jid: string | null;
};

type Phase =
  | { kind: 'form' }
  | { kind: 'pair'; created: CreateResponse; qr: string | null; meJid: string | null };

export function AddWhatsAppModal({
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
  const [displayName, setDisplayName] = React.useState('My WhatsApp');

  React.useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'form' });
    setSubmitting(false);
    setError(null);
    setDisplayName('My WhatsApp');
  }, [open]);

  // QR + status polling once we're on the pair phase.
  //
  // Cadence:
  //   - 500ms while we have no QR yet (Baileys can take 2–6s to issue
  //     the first one — we want to render it the instant it lands).
  //   - 2s once a QR is on screen (it only rotates every ~60s, so
  //     hammering the API more often is pure waste).
  React.useEffect(() => {
    if (!open || phase.kind !== 'pair') return;
    const id = phase.created.connection.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      let nextDelayMs = 500;
      try {
        const res = await fetch(`/api/external/whatsapp/${encodeURIComponent(id)}/qr`, {
          credentials: 'include',
        });
        if (!cancelled && res.ok) {
          const poll = (await res.json()) as QrPoll;
          if (poll.status === 'connected') {
            toast.success('WhatsApp connected', {
              description: poll.me_jid
                ? `Bound to ${poll.me_jid.split('@')[0]}.`
                : 'Self-chat is now wired up.',
            });
            onPaired();
            onClose();
            return;
          }
          if (poll.status === 'error') {
            try {
              const detail = await fetch(`/api/external/connections/${encodeURIComponent(id)}`, {
                credentials: 'include',
              });
              if (detail.ok) {
                const conn = (await detail.json()) as ExternalConnection;
                if (conn.error) setError(conn.error);
              }
            } catch {
              /* ignore */
            }
          } else {
            setPhase((prev) => {
              if (prev.kind !== 'pair') return prev;
              if (prev.qr === poll.qr && prev.meJid === poll.me_jid) return prev;
              return {
                kind: 'pair',
                created: prev.created,
                qr: poll.qr,
                meJid: poll.me_jid,
              };
            });
            nextDelayMs = poll.qr ? 2_000 : 500;
          }
        }
      } catch {
        /* network blip — retry next tick */
      }
      if (!cancelled) {
        timer = setTimeout(tick, nextDelayMs);
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
      const createRes = await fetch('/api/external/connections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'whatsapp',
          display_name: displayName.trim() || 'WhatsApp',
        }),
      });
      const createText = await createRes.text();
      if (!createRes.ok) throw parseHttpError(createText, createRes.status);
      const created = JSON.parse(createText) as CreateResponse;

      const startRes = await fetch(
        `/api/external/whatsapp/${encodeURIComponent(created.connection.id)}/start`,
        { method: 'POST', credentials: 'include' },
      );
      const startText = await startRes.text();
      if (!startRes.ok) throw parseHttpError(startText, startRes.status);
      // The session is live — the polling effect picks up the QR as
      // soon as Baileys emits it.
      setPhase({ kind: 'pair', created, qr: null, meJid: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshQr() {
    if (phase.kind !== 'pair') return;
    setError(null);
    try {
      const res = await fetch(
        `/api/external/whatsapp/${encodeURIComponent(phase.created.connection.id)}/start`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        throw parseHttpError(await res.text(), res.status);
      }
      // Force a fresh QR via the polling tick.
      setPhase({ kind: 'pair', created: phase.created, qr: null, meJid: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'refresh failed');
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elev shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-medium">
              {phase.kind === 'form' ? 'Connect WhatsApp' : 'Pair your phone'}
            </h2>
            <p className="text-xs text-fg-muted mt-0.5">
              {phase.kind === 'form'
                ? 'We\u2019ll link your WhatsApp via the same QR flow as WhatsApp Web.'
                : 'Open WhatsApp \u2192 Settings \u2192 Linked devices \u2192 Link a device.'}
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
            <SafetyHelp />

            <label className="block text-sm">
              <span className="text-fg-muted text-xs">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My WhatsApp"
                maxLength={120}
                required
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-[11px] text-fg-subtle">
                Shown in your settings list. Pick whatever you'll recognise later.
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
                    Starting
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </div>
          </form>
        ) : (
          <PairPhase
            qr={phase.qr}
            error={error}
            onRefresh={refreshQr}
            displayName={phase.created.connection.display_name ?? 'WhatsApp'}
          />
        )}
      </div>
    </div>
  );
}

function SafetyHelp() {
  return (
    <details className="rounded-md border border-border bg-bg/50 px-3 py-2 text-xs text-fg-muted">
      <summary className="cursor-pointer text-fg select-none">
        How does this work? Is it safe?
      </summary>
      <ol className="mt-2 space-y-1 list-decimal list-inside leading-relaxed">
        <li>
          We open a WhatsApp Web session under your account. Your phone shows it as a "Linked
          device" (you can revoke from there at any time).
        </li>
        <li>
          The bot only reads messages you send to <strong>yourself</strong> in your own WhatsApp
          self-chat. Group chats and DMs from others are ignored.
        </li>
        <li>
          Pairing keys are encrypted at rest with AES-GCM (same envelope as your LLM keys). Revoking
          the connection here logs the device out.
        </li>
      </ol>
    </details>
  );
}

function PairPhase({
  qr,
  error,
  onRefresh,
  displayName,
}: {
  qr: string | null;
  error: string | null;
  onRefresh: () => void;
  displayName: string;
}) {
  return (
    <div className="space-y-4 px-4 py-4">
      <div className="rounded-md border border-brand/30 bg-brand/8 p-3 text-xs text-fg">
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
          <span>
            Open WhatsApp on your phone, go to <em>Settings → Linked devices → Link a device</em>,
            and scan the QR. <strong>{displayName}</strong> shows up as a Chrome/Mac session.
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex aspect-square items-center justify-center rounded-md border border-border bg-white p-3">
          {qr ? (
            <QRCodeSVG value={qr} size={220} marginSize={2} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
              <Spinner size="sm" />
              <span className="text-xs">Connecting to WhatsApp Web…</span>
              <span className="text-[10.5px] text-fg-subtle">
                Usually takes 5–10 seconds on first pair
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg"
          >
            <RefreshCcw className="size-3" />
            <span>Re-issue QR</span>
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-bg p-3 text-xs">
        <Spinner size="sm" />
        <div className="text-fg-muted leading-snug">
          Waiting for your phone to pair.
          <span className="block text-[10.5px] text-fg-subtle">
            QR codes auto-rotate every ~60s — that's WhatsApp's design, not us. We swap in the next
            one automatically.
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger break-words">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function parseHttpError(text: string, status: number): Error {
  let message = `HTTP ${status}`;
  try {
    const j = JSON.parse(text) as { message?: string; error?: string };
    message = j.message ?? j.error ?? message;
  } catch {
    /* ignore */
  }
  if (status === 503) {
    return new Error(
      `${message} \u2014 ask the operator to set LEASH_WHATSAPP_ENABLED=1 on the apps/api host.`,
    );
  }
  return new Error(message);
}

'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CopyIcon,
  Loader2,
  RefreshCwIcon,
  ShieldAlertIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { ExternalConnection } from '@/components/external-add-telegram-modal';

type ListResponse = { items: ExternalConnection[] };

const fetcher = async (url: string): Promise<ListResponse> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ListResponse;
};

export function ExternalConnectionsTable({
  onAddTelegram,
  onAddWhatsApp,
}: {
  onAddTelegram: () => void;
  onAddWhatsApp: () => void;
}) {
  const { data, error, isLoading } = useSWR<ListResponse>('/api/external/connections', fetcher, {
    refreshInterval: 5_000,
    revalidateOnFocus: true,
  });

  const items = data?.items ?? [];

  return (
    <div className="rounded-lg border border-border bg-bg-elev overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium text-sm">External connections</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            Talk to your agent from Telegram or WhatsApp. One device per connection, bound to your
            own chat.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAddTelegram}
            className="border-brand/60 bg-transparent text-brand hover:bg-brand/8 hover:border-brand hover:text-brand"
          >
            + Add Telegram
          </Button>
          <Button type="button" size="sm" onClick={onAddWhatsApp}>
            + Add WhatsApp
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-fg-muted">
          <Spinner size="sm" /> Loading connections
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-sm text-danger">{(error as Error).message}</div>
      ) : items.length === 0 ? (
        <div className="space-y-1 px-4 py-10 text-center text-sm text-fg-muted">
          <p>No external chat connections yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((c) => (
            <ConnectionRow key={c.id} conn={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionRow({ conn }: { conn: ExternalConnection }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <li className="px-4 py-3 hover:bg-bg-elev/40">
      <div className="flex items-center gap-3">
        <ChannelIcon channel={conn.channel} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {conn.display_name || prettyChannel(conn.channel)}
            </span>
            <StatusBadge status={conn.status} channel={conn.channel} />
          </div>
          <div className="mt-0.5 truncate text-xs text-fg-muted">
            {conn.bot_username ? <span className="font-mono">@{conn.bot_username}</span> : null}
            {conn.bound_chat_id ? (
              <span className="ml-2">
                <span className="text-fg-subtle">·</span> chat{' '}
                <span className="font-mono">{conn.bound_chat_id}</span>
              </span>
            ) : null}
            {conn.last_seen_at ? (
              <span className="ml-2">
                <span className="text-fg-subtle">·</span> last seen {timeAgo(conn.last_seen_at)}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md p-1.5 text-fg-subtle hover:bg-bg hover:text-fg"
          aria-label={expanded ? 'Hide details' : 'Show details'}
        >
          {expanded ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
        </button>
      </div>

      {expanded ? <ConnectionDetails conn={conn} /> : null}
    </li>
  );
}

function ConnectionDetails({ conn }: { conn: ExternalConnection }) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = React.useState<'refresh' | 'delete' | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  // Latched after a WhatsApp refresh so we keep polling the QR endpoint
  // and rendering the inline pair pane until the connection flips back
  // to 'connected'. Without this, the QR widget would only show while
  // the row was already in 'pending' status, hiding it during the brief
  // window where Baileys re-issues the QR but the DB still says
  // 'connected'.
  const [waPolling, setWaPolling] = React.useState(false);

  async function refresh() {
    setBusy('refresh');
    try {
      if (conn.channel === 'whatsapp') {
        // For WhatsApp, "Refresh" means: bring the Baileys socket back
        // online. The manager re-uses saved creds (passive login) and
        // only emits a fresh QR if WhatsApp's server rejects them. We
        // never rotate any token here — that was the wrong action for
        // WA and the source of the "asks me to re-pair" complaint.
        const res = await fetch(`/api/external/whatsapp/${encodeURIComponent(conn.id)}/start`, {
          method: 'POST',
          credentials: 'include',
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(parseError(text) || `HTTP ${res.status}`);
        }
        const result = JSON.parse(text) as {
          status: 'pairing' | 'connecting' | 'connected' | 'error';
          reason?: string;
        };
        if (result.status === 'connected') {
          toast.success('WhatsApp reconnected', {
            description: 'Saved session was still valid — no re-pair needed.',
          });
        } else if (result.status === 'error') {
          toast.error('Reconnect failed', {
            description: result.reason ?? 'unknown error',
          });
        } else {
          toast.message('Re-pairing your WhatsApp', {
            description: 'Saved session was rejected. Scan the new QR below.',
          });
          // Latch the inline poller so the QR pane shows up even though
          // the row's status is still 'connected' for a few seconds.
          setWaPolling(true);
        }
      } else {
        const res = await fetch(
          `/api/external/connections/${encodeURIComponent(conn.id)}/refresh`,
          { method: 'POST', credentials: 'include' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          telegram_webhook_registered?: boolean;
          telegram_webhook_error?: string | null;
        };
        if (body.telegram_webhook_registered === false && body.telegram_webhook_error) {
          toast.warning('Refresh saved', {
            description: `Webhook not updated: ${body.telegram_webhook_error}`,
          });
        } else {
          toast.success('Telegram connection refreshed', {
            description: 'Verification link rotated and webhook synced.',
          });
        }
      }
      await mutate('/api/external/connections');
    } catch (err) {
      toast.error('Refresh failed', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      const res = await fetch(`/api/external/connections/${encodeURIComponent(conn.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Connection deleted');
      await mutate('/api/external/connections');
    } catch (err) {
      toast.error('Delete failed', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
      throw err;
    } finally {
      setBusy(null);
    }
  }

  // For WhatsApp connections we show an inline QR re-pair pane whenever:
  //   - the row is in 'pending' status (fresh re-pair flow), OR
  //   - the user just clicked Refresh and we latched `waPolling` until
  //     the manager confirms the saved session was reusable.
  const showInlineWaPair = conn.channel === 'whatsapp' && (conn.status === 'pending' || waPolling);

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-bg p-3 text-xs">
      <SigningModeEditor conn={conn} />

      {conn.channel === 'telegram' && conn.telegram_webhook_url ? (
        <details className="rounded-md border border-border bg-bg-elev px-2.5 py-2">
          <summary className="cursor-pointer text-fg select-none text-[11px] font-medium uppercase tracking-wide">
            Webhook URL
          </summary>
          <p className="mt-2 text-[10.5px] text-fg-muted leading-snug">
            Telegram delivers bot updates to this HTTPS endpoint. It is registered automatically
            when you add or refresh the connection — you do not need curl or BotFather.
          </p>
          <div className="mt-2 flex items-center gap-1">
            <code className="flex-1 wrap-break-word rounded border border-border bg-bg px-2 py-1.5 font-mono text-[10px] text-fg-muted">
              {conn.telegram_webhook_url}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(conn.telegram_webhook_url!);
                toast.success('Copied');
              }}
              className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg hover:text-fg"
              aria-label="Copy webhook URL"
            >
              <CopyIcon className="size-3" />
            </button>
          </div>
        </details>
      ) : null}

      {conn.channel === 'telegram' &&
      conn.status === 'pending' &&
      conn.verification_token &&
      conn.bot_username ? (
        <TelegramFinishLinkBlock
          deepLink={`https://t.me/${conn.bot_username}?start=${conn.verification_token}`}
          botUsername={conn.bot_username}
        />
      ) : null}

      {showInlineWaPair ? (
        <WhatsAppPairBlock
          connectionId={conn.id}
          onConnected={() => {
            setWaPolling(false);
            toast.success('WhatsApp connected', {
              description: 'You can keep messaging the bot.',
            });
            void mutate('/api/external/connections');
          }}
        />
      ) : null}

      {conn.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/8 px-2.5 py-2 text-danger break-words">
          {conn.error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={busy != null || conn.status === 'revoked'}
          className="h-7 px-2 text-[11px]"
        >
          {busy === 'refresh' ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <RefreshCwIcon className="mr-1 size-3" />
          )}
          Refresh
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={busy != null}
          className="h-7 px-2 text-[11px] text-danger hover:bg-danger/10"
        >
          {busy === 'delete' ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <Trash2Icon className="mr-1 size-3" />
          )}
          Delete connection
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete this connection?"
        description={
          <div className="space-y-2">
            <p>
              This permanently removes{' '}
              <strong>{conn.display_name || prettyChannel(conn.channel)}</strong> and all of its
              message history.
            </p>
            {conn.channel === 'whatsapp' ? (
              <p className="text-[11px] text-fg-subtle">
                Your linked-device session will be logged out from WhatsApp. You can re-pair anytime
                with a new connection.
              </p>
            ) : (
              <p className="text-[11px] text-fg-subtle">
                The bot token stays valid in BotFather — re-add it any time to reconnect.
              </p>
            )}
          </div>
        }
        confirmLabel="Delete connection"
        destructive
        onConfirm={async () => {
          await remove();
          setConfirmDeleteOpen(false);
        }}
      />
    </div>
  );
}

function SigningModeEditor({ conn }: { conn: ExternalConnection }) {
  const { mutate } = useSWRConfig();
  const [mode, setMode] = React.useState<'deep_link' | 'delegated'>(conn.signing_mode);
  const [capPerTx, setCapPerTx] = React.useState(conn.cap_per_tx ?? '');
  const [capPerDay, setCapPerDay] = React.useState(conn.cap_per_day ?? '');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setMode(conn.signing_mode);
    setCapPerTx(conn.cap_per_tx ?? '');
    setCapPerDay(conn.cap_per_day ?? '');
  }, [conn.signing_mode, conn.cap_per_tx, conn.cap_per_day]);

  const dirty =
    mode !== conn.signing_mode ||
    capPerTx !== (conn.cap_per_tx ?? '') ||
    capPerDay !== (conn.cap_per_day ?? '');

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { signing_mode: mode };
      if (mode === 'delegated') {
        if (!capPerTx.match(/^\d+(\.\d+)?$/) || !capPerDay.match(/^\d+(\.\d+)?$/)) {
          toast.error('Both caps are required for delegated mode (decimal numbers).');
          setSaving(false);
          return;
        }
        body.cap_per_tx = capPerTx;
        body.cap_per_day = capPerDay;
      }
      const res = await fetch(`/api/external/connections/${encodeURIComponent(conn.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Signing mode updated');
      await mutate('/api/external/connections');
    } catch (err) {
      toast.error('Update failed', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Signing</div>

      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ModeOption
          checked={mode === 'deep_link'}
          onChange={() => setMode('deep_link')}
          label="Deep-link confirm"
          description="Bot replies with a one-time link to sign here in the browser. Safest — server never holds keys."
        />
        <ModeOption
          checked={mode === 'delegated'}
          onChange={() => setMode('delegated')}
          label="Delegated (caps)"
          description="Server-held key signs inline up to your caps. Faster but you're trusting the host with a bounded delegate."
          warn
        />
      </fieldset>

      {mode === 'delegated' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px]">
            <span className="text-fg-subtle">Per-tx cap (USDC)</span>
            <input
              value={capPerTx}
              onChange={(e) => setCapPerTx(e.target.value)}
              placeholder="5"
              className="mt-1 w-full rounded-md border border-border bg-bg-elev px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-[11px]">
            <span className="text-fg-subtle">Per-day cap (USDC)</span>
            <input
              value={capPerDay}
              onChange={(e) => setCapPerDay(e.target.value)}
              placeholder="50"
              className="mt-1 w-full rounded-md border border-border bg-bg-elev px-2 py-1.5 text-xs"
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={save}
          disabled={!dirty || saving}
          className="h-7 px-2.5 text-[11px]"
        >
          {saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
          Save signing
        </Button>
      </div>
    </div>
  );
}

function ModeOption({
  checked,
  onChange,
  label,
  description,
  warn,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
  warn?: boolean;
}) {
  return (
    <label
      className={`cursor-pointer rounded-md border px-2.5 py-2 text-[11px] transition-colors ${
        checked
          ? warn
            ? 'border-warning/60 bg-warning/8'
            : 'border-brand/60 bg-brand/8'
          : 'border-border bg-bg-elev hover:border-border-strong'
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="radio"
          name="signing_mode"
          checked={checked}
          onChange={onChange}
          className="mt-0.5"
        />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-fg">{label}</span>
            {warn ? <ShieldAlertIcon className="size-3 text-warning" /> : null}
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-fg-muted">{description}</p>
        </div>
      </div>
    </label>
  );
}

function TelegramFinishLinkBlock({
  deepLink,
  botUsername,
}: {
  deepLink: string;
  botUsername: string;
}) {
  return (
    <div className="rounded-md border border-sky-500/25 bg-sky-500/5 px-2.5 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-sky-400">
        Authorize your chat
      </div>
      <p className="mt-1 text-[10.5px] text-fg-muted leading-snug">
        Webhook is live, but Leash only runs your agent for chats that complete this step. Open the
        link and tap <strong>Start</strong> once (<span className="font-mono">@{botUsername}</span>)
        — then you can message normally.
      </p>
      <div className="mt-2 flex items-center gap-1">
        <a
          href={deepLink}
          target="_blank"
          rel="noreferrer"
          className="flex-1 wrap-break-word font-mono text-[11px] text-brand hover:underline"
        >
          {deepLink}
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(deepLink);
            toast.success('Copied');
          }}
          className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg hover:text-fg"
          aria-label="Copy open-in-Telegram link"
        >
          <CopyIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

type WaQrPoll = {
  qr: string | null;
  qr_at: string | null;
  status: ExternalConnection['status'];
  me_jid: string | null;
};

/**
 * Inline QR pane shown directly inside the connection row.
 *
 * Used in two situations:
 *   1. The row is in `pending` (fresh re-pair flow — manager has
 *      issued a QR but the user hasn't scanned yet).
 *   2. The user clicked "Refresh" and the manager couldn't reuse the
 *      saved Baileys session, so a fresh QR was generated. The
 *      parent `ConnectionDetails` keeps `waPolling=true` until the
 *      connection flips back to `connected`, at which point we call
 *      `onConnected` and the parent un-latches.
 *
 * Polling cadence mirrors the Add-WhatsApp modal: 500ms while waiting
 * for the first QR to appear, 2s once a QR is on screen (since
 * WhatsApp rotates them every ~60s, hammering the API more often is
 * wasted bandwidth).
 *
 * IMPORTANT: we must POST `/start` before polling `/qr`, same as the
 * modal. Polling alone never spins up Baileys — without `start` the
 * `last_qr` column stays empty and the UI shows a spinner forever.
 */
function WhatsAppPairBlock({
  connectionId,
  onConnected,
}: {
  connectionId: string;
  onConnected: () => void;
}) {
  const [poll, setPoll] = React.useState<WaQrPoll | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [sessionStarting, setSessionStarting] = React.useState(true);
  const onConnectedRef = React.useRef(onConnected);
  onConnectedRef.current = onConnected;

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function bootAndPoll() {
      setSessionStarting(true);
      setErr(null);
      try {
        const startRes = await fetch(
          `/api/external/whatsapp/${encodeURIComponent(connectionId)}/start`,
          { method: 'POST', credentials: 'include' },
        );
        const startText = await startRes.text();
        if (!startRes.ok) {
          if (!cancelled) {
            setErr(parseError(startText) || `Start failed (HTTP ${startRes.status})`);
            setSessionStarting(false);
          }
          return;
        }
        try {
          const parsed = JSON.parse(startText) as { status?: string; reason?: string };
          if (parsed.status === 'error' && parsed.reason && !cancelled) {
            setErr(parsed.reason);
            setSessionStarting(false);
            return;
          }
        } catch {
          /* ignore malformed success body */
        }
      } catch {
        if (!cancelled) {
          setErr('Could not reach the WhatsApp bridge');
          setSessionStarting(false);
        }
        return;
      }
      if (!cancelled) setSessionStarting(false);

      async function tick() {
        let nextDelayMs = 500;
        try {
          const res = await fetch(`/api/external/whatsapp/${encodeURIComponent(connectionId)}/qr`, {
            credentials: 'include',
          });
          if (!cancelled && res.ok) {
            const next = (await res.json()) as WaQrPoll;
            setPoll(next);
            if (next.status === 'connected') {
              onConnectedRef.current();
              return;
            }
            nextDelayMs = next.qr ? 2_000 : 500;
          } else if (!cancelled) {
            setErr(`HTTP ${res.status}`);
          }
        } catch {
          // Treat as transient — retry next tick.
        }
        if (!cancelled) {
          timer = setTimeout(tick, nextDelayMs);
        }
      }
      void tick();
    }

    void bootAndPoll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [connectionId]);

  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-400">
        Re-pair WhatsApp
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">
        Open WhatsApp → <em>Settings → Linked devices → Link a device</em> and scan the QR. The bot
        re-binds automatically the moment your phone confirms the pair.
      </p>
      <div className="mt-2 flex aspect-square w-full max-w-[200px] mx-auto items-center justify-center rounded-md border border-border bg-white p-2">
        {poll?.qr ? (
          <QRCodeSVG value={poll.qr} size={180} marginSize={2} />
        ) : (
          <div className="flex flex-col items-center gap-1.5 py-6 text-fg-muted">
            <Spinner size="sm" />
            <span className="text-[10.5px] text-center px-1">
              {sessionStarting ? 'Starting WhatsApp session…' : 'Connecting to WhatsApp Web…'}
            </span>
          </div>
        )}
      </div>
      <p className="mt-2 text-[10.5px] text-fg-subtle">
        QR codes auto-rotate every ~60s — that&rsquo;s WhatsApp&rsquo;s design. We swap the next one
        in for you.
      </p>
      {err ? <p className="mt-1 text-[10.5px] text-danger">{err}</p> : null}
    </div>
  );
}

/** Parse the JSON `{ message }` shape apps/api error responses use. */
function parseError(text: string): string | null {
  try {
    const j = JSON.parse(text) as { message?: string; error?: string };
    return j.message ?? j.error ?? null;
  } catch {
    return null;
  }
}

function ChannelIcon({ channel }: { channel: 'telegram' | 'whatsapp' }) {
  // Plain colored disc — keeps the row light without bundling brand SVGs.
  const isTg = channel === 'telegram';
  return (
    <div
      className={`flex size-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
        isTg ? 'bg-sky-500/15 text-sky-400' : 'bg-emerald-500/15 text-emerald-400'
      }`}
      aria-hidden
    >
      {isTg ? 'TG' : 'WA'}
    </div>
  );
}

function StatusBadge({
  status,
  channel,
}: {
  status: ExternalConnection['status'];
  channel: ExternalConnection['channel'];
}) {
  const map: Record<
    ExternalConnection['status'],
    { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    pending: {
      label: channel === 'telegram' ? 'Live' : 'Pending',
      cls:
        channel === 'telegram'
          ? 'bg-emerald-500/15 text-emerald-300'
          : 'bg-amber-500/15 text-amber-300',
      Icon: channel === 'telegram' ? CheckCircle2Icon : ClockIcon,
    },
    connected: {
      label: 'Connected',
      cls: 'bg-emerald-500/15 text-emerald-300',
      Icon: CheckCircle2Icon,
    },
    error: {
      label: 'Error',
      cls: 'bg-danger/15 text-danger',
      Icon: ShieldAlertIcon,
    },
    revoked: {
      label: 'Revoked',
      cls: 'bg-bg text-fg-subtle',
      Icon: XCircleIcon,
    },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function prettyChannel(c: ExternalConnection['channel']): string {
  return c === 'telegram' ? 'Telegram' : 'WhatsApp';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

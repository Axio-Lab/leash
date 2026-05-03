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

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
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
            own chat — DMs from anyone else are ignored.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onAddTelegram}>
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
          <p className="text-xs">
            Add Telegram to get a one-to-one bot for your agent — same tools as the chat UI,
            surfaced in Telegram.
          </p>
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
            <StatusBadge status={conn.status} />
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

  async function refresh() {
    setBusy('refresh');
    try {
      const res = await fetch(`/api/external/connections/${encodeURIComponent(conn.id)}/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Verification token rotated', {
        description: 'Open the new pair link from your bot settings.',
      });
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
    if (!confirm('Revoke this connection? The bot will stop working immediately.')) return;
    setBusy('delete');
    try {
      const res = await fetch(`/api/external/connections/${encodeURIComponent(conn.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Connection revoked');
      await mutate('/api/external/connections');
    } catch (err) {
      toast.error('Revoke failed', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-bg p-3 text-xs">
      <SigningModeEditor conn={conn} />

      {conn.status === 'pending' && conn.verification_token && conn.bot_username ? (
        <PairLinkBlock
          deepLink={`https://t.me/${conn.bot_username}?start=${conn.verification_token}`}
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
          Rotate pair link
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={remove}
          disabled={busy != null || conn.status === 'revoked'}
          className="h-7 px-2 text-[11px] text-danger hover:bg-danger/10"
        >
          {busy === 'delete' ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <Trash2Icon className="mr-1 size-3" />
          )}
          Revoke
        </Button>
      </div>
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

function PairLinkBlock({ deepLink }: { deepLink: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-elev px-2.5 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        Pair link
      </div>
      <div className="mt-1 flex items-center gap-1">
        <a
          href={deepLink}
          target="_blank"
          rel="noreferrer"
          className="flex-1 break-all font-mono text-[11px] text-brand hover:underline"
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
          aria-label="Copy pair link"
        >
          <CopyIcon className="size-3" />
        </button>
      </div>
      <p className="mt-1 text-[10.5px] text-fg-muted">
        Open this from your phone or paste it in Telegram. The bot will detect the bind
        automatically.
      </p>
    </div>
  );
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

function StatusBadge({ status }: { status: ExternalConnection['status'] }) {
  const map: Record<
    ExternalConnection['status'],
    { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    pending: {
      label: 'Pending',
      cls: 'bg-amber-500/15 text-amber-300',
      Icon: ClockIcon,
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

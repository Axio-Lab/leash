'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Loader2, SearchIcon, X } from 'lucide-react';

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{
    items?: Array<{
      slug: string;
      name: string;
      logo: string | null;
      description: string;
      tools_count: number | null;
      categories: Array<{ slug: string; name: string }>;
      auth_schemes: string[];
      no_auth: boolean;
    }>;
    warning?: string;
    total?: number;
    all_total?: number;
  }>;
};

const connFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{
    items?: Array<{ id?: string; toolkit_slug?: string; status?: string }>;
  }>;
};

const detailFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{
    toolkit: {
      slug: string;
      name: string;
      logo: string | null;
      description: string;
      tools_count: number | null;
      categories: Array<{ slug: string; name: string }>;
    } | null;
    tools: Array<{ slug: string; name: string; description: string; no_auth: boolean }>;
  }>;
};

const PER_PAGE = 24;

type ToolkitCard = NonNullable<Awaited<ReturnType<typeof fetcher>>['items']>[number];

export default function ConnectionsSettingsPage() {
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [openToolkit, setOpenToolkit] = React.useState<ToolkitCard | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  const url = `/api/composio/toolkits${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ''}`;
  const { data: tk, error: tkErr, isLoading } = useSWR(url, fetcher, { revalidateOnFocus: false });
  const { data: cx, mutate } = useSWR('/api/composio/connections', connFetcher);

  async function connect(slug: string) {
    const res = await fetch('/api/composio/connect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolkit_slug: slug }),
    });
    const j = (await res.json().catch(() => ({}))) as { redirect_url?: string; error?: string };
    if (!res.ok) {
      alert(j.error ?? 'connect failed');
      return;
    }
    if (j.redirect_url) window.location.href = j.redirect_url;
  }

  async function disconnect(id: string) {
    if (!confirm('Disconnect this toolkit for your agent?')) return;
    await fetch('/api/composio/connections', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    void mutate();
  }

  const items = tk?.items ?? [];
  const allTotal = tk?.all_total ?? items.length;
  const connections = cx?.items ?? [];
  const connectedSlugs = new Set(
    connections
      .filter((c) => c.status === 'ACTIVE' && c.toolkit_slug)
      .map((c) => c.toolkit_slug as string),
  );

  const sorted = [...items].sort((a, b) => {
    const aOn = connectedSlugs.has(a.slug) ? 1 : 0;
    const bOn = connectedSlugs.has(b.slug) ? 1 : 0;
    if (aOn !== bOn) return bOn - aOn;
    return a.name.localeCompare(b.name);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * PER_PAGE;
  const visible = sorted.slice(start, start + PER_PAGE);

  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">
        Connect OAuth apps once — your agent receives every tool from that toolkit on the next
        message.
      </p>

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search toolkits (gmail, github, slack…)"
          className="w-full rounded-lg border border-border bg-bg pl-9 pr-3 py-2.5 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
        />
      </div>

      {tk?.warning ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          {tk.warning}
        </div>
      ) : null}
      {tkErr ? <div className="text-sm text-danger">Could not load toolkits.</div> : null}

      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>
          {connectedSlugs.size} connected ·{' '}
          {debouncedQ
            ? `${sorted.length} matching of ${allTotal} total`
            : `${sorted.length} toolkits`}
        </span>
        {totalPages > 1 ? (
          <span>
            Page {clampedPage} / {totalPages}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
        {isLoading && visible.length === 0
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="rounded-xl border border-border bg-bg-elev/40 h-[160px] animate-pulse"
              />
            ))
          : visible.map((t) => {
              const conn = connections.find(
                (c) => c.toolkit_slug === t.slug && c.status === 'ACTIVE',
              );
              const isConnected = Boolean(conn?.id);
              return (
                <button
                  type="button"
                  key={t.slug}
                  onClick={() => setOpenToolkit(t)}
                  className="text-left rounded-xl border border-border bg-bg-elev p-3 sm:p-3.5 flex flex-col gap-2.5 min-h-[160px] hover:border-border-strong hover:bg-bg-elev-2 transition-colors focus:outline-none focus:ring-1 focus:ring-brand/40"
                >
                  <div className="flex items-start gap-2.5">
                    {t.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.logo}
                        alt=""
                        className="size-8 rounded-md bg-bg shrink-0 object-contain p-1 border border-border"
                        loading="lazy"
                      />
                    ) : (
                      <div className="size-8 rounded-md bg-bg-elev-2 shrink-0 grid place-items-center text-[10px] font-mono text-fg-subtle uppercase">
                        {t.slug.slice(0, 2)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" title={t.name}>
                        {t.name}
                      </div>
                      <div className="text-[10px] text-fg-subtle font-mono truncate">{t.slug}</div>
                    </div>
                  </div>

                  {t.description ? (
                    <p className="text-xs text-fg-muted leading-snug line-clamp-2">
                      {t.description}
                    </p>
                  ) : null}

                  <div className="mt-auto flex items-center justify-between gap-2">
                    {isConnected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/40 text-emerald-300 px-2 py-0.5 text-[10px] font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        Connected
                      </span>
                    ) : t.tools_count != null ? (
                      <span className="text-[10px] text-fg-subtle font-mono">
                        {t.tools_count} tools
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="text-xs text-fg-subtle group-hover:text-fg">View →</span>
                  </div>
                </button>
              );
            })}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50 hover:border-border-strong"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={clampedPage <= 1}
          >
            Prev
          </button>
          <span className="text-xs text-fg-muted px-2">
            {clampedPage} / {totalPages}
          </span>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50 hover:border-border-strong"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={clampedPage >= totalPages}
          >
            Next
          </button>
        </div>
      ) : null}

      {!isLoading && items.length === 0 && !tkErr ? (
        <p className="text-sm text-fg-muted text-center py-8">
          {debouncedQ ? `No toolkits match "${debouncedQ}".` : 'No toolkits available.'}
        </p>
      ) : null}

      {openToolkit ? (
        <ToolkitModal
          toolkit={openToolkit}
          isConnected={connectedSlugs.has(openToolkit.slug)}
          connectionId={
            connections.find((c) => c.toolkit_slug === openToolkit.slug && c.status === 'ACTIVE')
              ?.id ?? null
          }
          onClose={() => setOpenToolkit(null)}
          onConnect={() => void connect(openToolkit.slug)}
          onDisconnect={(id) => void disconnect(id)}
        />
      ) : null}
    </div>
  );
}

function ToolkitModal({
  toolkit,
  isConnected,
  connectionId,
  onClose,
  onConnect,
  onDisconnect,
}: {
  toolkit: ToolkitCard;
  isConnected: boolean;
  connectionId: string | null;
  onClose: () => void;
  onConnect: () => void;
  onDisconnect: (id: string) => void;
}) {
  const { data, error, isLoading } = useSWR(
    `/api/composio/toolkits/${encodeURIComponent(toolkit.slug)}`,
    detailFetcher,
    { revalidateOnFocus: false },
  );

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const tools = data?.tools ?? [];
  const description = data?.toolkit?.description || toolkit.description;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="toolkit-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl max-h-[90vh] sm:max-h-[80vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-border bg-bg-elev shadow-2xl">
        <div className="shrink-0 flex items-start gap-3 border-b border-border p-4 sm:p-5">
          {toolkit.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={toolkit.logo}
              alt=""
              className="size-11 rounded-lg bg-bg shrink-0 object-contain p-1.5 border border-border"
            />
          ) : (
            <div className="size-11 rounded-lg bg-bg-elev-2 shrink-0 grid place-items-center text-xs font-mono text-fg-subtle uppercase">
              {toolkit.slug.slice(0, 2)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2
              id="toolkit-modal-title"
              className="text-base sm:text-lg font-semibold tracking-tight truncate"
            >
              {toolkit.name}
            </h2>
            <div className="text-[11px] sm:text-xs text-fg-subtle font-mono truncate">
              {toolkit.slug}
            </div>
            {toolkit.categories.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {toolkit.categories.slice(0, 4).map((c) => (
                  <span
                    key={c.slug || c.name}
                    className="rounded-full bg-bg-elev-2 text-fg-muted px-2 py-0.5 text-[10px] font-medium"
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border p-1.5 text-fg-muted hover:border-border-strong hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-5 py-4 space-y-4">
          {description ? (
            <p className="text-sm text-fg-muted leading-relaxed">{description}</p>
          ) : null}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold tracking-widest uppercase text-fg-subtle">
                Tools included
              </h3>
              {tools.length > 0 ? (
                <span className="text-xs text-fg-muted font-mono">{tools.length}</span>
              ) : null}
            </div>

            {error ? (
              <div className="text-sm text-danger">Could not load tools for this toolkit.</div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted py-4">
                <Loader2 className="size-4 animate-spin" />
                Loading tools…
              </div>
            ) : tools.length === 0 ? (
              <p className="text-sm text-fg-muted">No tools listed.</p>
            ) : (
              <ul className="space-y-2">
                {tools.map((t) => (
                  <li key={t.slug} className="rounded-lg border border-border bg-bg/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{t.name}</div>
                        <div className="text-[10px] text-fg-subtle font-mono truncate">
                          {t.slug}
                        </div>
                      </div>
                      {t.no_auth ? (
                        <span className="shrink-0 rounded-full bg-bg-elev-2 text-fg-muted px-2 py-0.5 text-[10px]">
                          No auth
                        </span>
                      ) : null}
                    </div>
                    {t.description ? (
                      <p className="mt-1.5 text-xs text-fg-muted leading-snug line-clamp-3">
                        {t.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border p-3 sm:p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-fg-muted">
            {isConnected ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Connected
              </span>
            ) : (
              <span>Not connected</span>
            )}
          </div>
          {isConnected && connectionId ? (
            <button
              type="button"
              onClick={() => onDisconnect(connectionId)}
              className="rounded-md border border-danger/40 text-danger px-3 py-1.5 text-sm hover:bg-danger/10"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              className="rounded-md bg-brand text-white px-4 py-1.5 text-sm font-medium hover:bg-brand-strong"
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

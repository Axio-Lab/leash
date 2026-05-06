'use client';

import * as React from 'react';
import useSWR from 'swr';
import { SearchIcon, X } from 'lucide-react';

import { Spinner } from '@/components/ui/spinner';
import { loadFavorites, saveFavorites, type FavoriteEntry } from '@/lib/favorites';

import { usePrivy } from '@privy-io/react-auth';

const PER_PAGE = 10;

type DiscoverSource = 'leash' | 'pay-skills';

type DiscoverRow = {
  slug: string;
  title: string;
  description: string;
  url: string;
  source: DiscoverSource;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
};

type PaySkillsEndpoint = {
  method: string;
  url: string;
  description?: string;
  protocol?: string[];
  supported_usd?: string[];
  probe_status?: string;
  pricing?: {
    dimensions?: Array<{ tiers?: Array<{ price_usd?: number }> }>;
  } | null;
};

type PaySkillsProviderResp = {
  fqn: string;
  title: string;
  service_url: string;
  endpoints: PaySkillsEndpoint[];
};

type MarketplaceSearchResponse = {
  items?: unknown[];
  discover_error?: {
    upstream_status?: number;
    upstream_url?: string;
    detail?: string;
  };
  error?: string;
};

const searchFetcher = async (url: string): Promise<MarketplaceSearchResponse> => {
  const res = await fetch(url, { credentials: 'include' });
  const json = (await res.json()) as MarketplaceSearchResponse;
  if (!res.ok) {
    return {
      items: [],
      error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}`,
    };
  }
  return json;
};

const endpointsFetcher = async (url: string): Promise<PaySkillsProviderResp | null> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json() as Promise<PaySkillsProviderResp>;
};

function endpointPrice(ep: PaySkillsEndpoint): string {
  const tier = ep.pricing?.dimensions?.[0]?.tiers?.[0]?.price_usd;
  return typeof tier === 'number' ? `$${tier}` : 'variable';
}

function priceLabel(row: DiscoverRow): string {
  if (row.pricing_type === 'free') return 'free';
  if (row.pricing_type === 'variable') return 'variable';
  return row.price_usdc ? `${row.price_usdc} USDC/call` : '—';
}

function sourceLabel(source: DiscoverSource): string {
  return source === 'pay-skills' ? 'pay.sh' : 'Leash';
}

export default function FavoritesSettingsPage() {
  const { user } = usePrivy();
  const pid = user?.id ?? '';
  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState<'all' | DiscoverSource>('all');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedQ, sourceFilter]);

  // Always load: empty/short query = browse mode (no `capability` on the API).
  // 2+ chars narrows via `debouncedQ` → BFF → `capability`.
  const swrKey = (() => {
    const params = new URLSearchParams();
    if (debouncedQ.length >= 2) params.set('q', debouncedQ);
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    return `/api/marketplace-search?${params}`;
  })();
  const { data, isLoading } = useSWR(swrKey, searchFetcher, { revalidateOnFocus: false });
  const [local, setLocal] = React.useState<FavoriteEntry[]>([]);
  const [openProvider, setOpenProvider] = React.useState<DiscoverRow | null>(null);

  React.useEffect(() => {
    if (!pid) return;
    setLocal(loadFavorites(pid));
  }, [pid]);

  function toggleFavorite(entry: FavoriteEntry) {
    if (!pid) return;
    const next = local.some((x) => x.slug === entry.slug && x.listingId === entry.listingId)
      ? local.filter((x) => !(x.slug === entry.slug && x.listingId === entry.listingId))
      : [...local, entry];
    setLocal(next);
    saveFavorites(pid, next);
  }

  const rawItems = data?.items ?? [];
  const rows = rawItems
    .map((row): DiscoverRow | null => {
      const r = row as Record<string, unknown>;
      const slug = typeof r.slug === 'string' ? r.slug : '';
      if (!slug) return null;
      const title = typeof r.title === 'string' ? r.title : slug;
      const description = typeof r.description === 'string' ? r.description : '';
      const url = typeof r.url === 'string' ? r.url : '';
      const source: DiscoverSource = r.source === 'pay-skills' ? 'pay-skills' : 'leash';
      const price_usdc = typeof r.price_usdc === 'string' ? r.price_usdc : null;
      const pricing_type =
        r.pricing_type === 'free' || r.pricing_type === 'per_call' || r.pricing_type === 'variable'
          ? r.pricing_type
          : 'variable';
      return { slug, title, description, url, source, price_usdc, pricing_type };
    })
    .filter((x): x is DiscoverRow => x != null);

  function entryFor(row: DiscoverRow): FavoriteEntry {
    return {
      slug: row.slug,
      kind: row.source === 'leash' ? 'agent' : 'tool',
      listingId: row.slug,
      title: row.title,
      ...(row.price_usdc ? { pricePerCallUsdc: row.price_usdc } : {}),
      source: row.source,
      ...(row.url ? { url: row.url } : {}),
    };
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * PER_PAGE;
  const visible = rows.slice(start, start + PER_PAGE);

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-muted">
        Browse the merged catalogue below, or type two or more characters to filter (same flow as{' '}
        <code className="font-mono text-xs">pay skills search</code> in the pay.sh CLI). Covers the
        Leash marketplace and the Solana Foundation{' '}
        <a
          href="https://github.com/solana-foundation/pay-skills"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-fg"
        >
          pay-skills
        </a>{' '}
        registry — every entry is payable today via the buyer-kit.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-md">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search catalog (2+ chars) — e.g. translate, email, crypto…"
            className="w-full rounded-lg border border-border bg-bg pl-9 pr-3 py-2.5 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
          />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-bg p-0.5 text-xs">
          {(['all', 'leash', 'pay-skills'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSourceFilter(s)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                sourceFilter === s ? 'bg-bg-elev text-fg' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {s === 'all' ? 'All' : s === 'leash' ? 'Leash' : 'pay.sh'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>
          {debouncedQ.length >= 2
            ? `${rows.length} result${rows.length !== 1 ? 's' : ''} · ${local.length} pinned`
            : `${rows.length} in catalog · ${local.length} pinned`}
        </span>
        {totalPages > 1 ? (
          <span>
            Page {clampedPage} / {totalPages}
          </span>
        ) : null}
      </div>
      {data?.discover_error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <div className="font-medium">Discovery API unreachable</div>
          <p className="text-xs mt-1 opacity-90">
            Point <code className="font-mono">LEASH_API_URL</code> in{' '}
            <code className="font-mono">apps/agents/.env</code> at your running API (e.g.{' '}
            <code className="font-mono">http://localhost:8801</code>) and restart{' '}
            <code className="font-mono">pnpm --filter @leashmarket/agents dev</code>.
          </p>
          {data.discover_error.detail ? (
            <pre className="mt-2 text-[10px] whitespace-pre-wrap break-all opacity-80">
              {data.discover_error.detail}
            </pre>
          ) : null}
          {data.discover_error.upstream_url ? (
            <div className="text-[10px] mt-1 font-mono break-all opacity-80">
              {data.discover_error.upstream_url}
            </div>
          ) : null}
        </div>
      ) : null}
      {data?.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {data.error}
        </div>
      ) : null}
      {isLoading && visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-fg-muted">
          <Spinner size="lg" brand />
          <span>Loading catalog…</span>
        </div>
      ) : null}
      <div className="space-y-2">
        {isLoading && visible.length === 0
          ? null
          : visible.map((row) => {
              const entry = entryFor(row);
              const active = local.some(
                (x) => x.slug === entry.slug && x.listingId === entry.listingId,
              );
              return (
                <DiscoverRowCard
                  key={`${row.source}-${row.slug}`}
                  row={row}
                  active={active}
                  onTogglePin={() => toggleFavorite(entry)}
                  onOpenEndpoints={() => setOpenProvider(row)}
                />
              );
            })}
        {!isLoading && debouncedQ.length >= 2 && rows.length === 0 && !data?.discover_error ? (
          <div className="text-sm text-fg-muted px-1">No results for that filter.</div>
        ) : null}
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
      <div>
        <div className="text-sm font-medium mb-2">Pinned ({local.length})</div>
        {local.length === 0 ? (
          <div className="text-xs text-fg-muted mb-2">
            Nothing pinned yet — browse or filter above, then tap “Pin” to save.
          </div>
        ) : null}
        <ul className="text-sm text-fg-muted space-y-1">
          {local.map((l) => (
            <li key={`${l.slug}-${l.listingId}`} className="flex items-center gap-2">
              <span className="truncate">{l.title}</span>
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  (l.source ?? 'leash') === 'leash'
                    ? 'bg-brand/15 text-brand'
                    : 'bg-fg-muted/15 text-fg-muted'
                }`}
              >
                {sourceLabel(l.source ?? 'leash')}
              </span>
              <button
                type="button"
                className="text-danger ml-2 hover:underline"
                onClick={() => toggleFavorite(l)}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      </div>
      {openProvider ? (
        <EndpointsModal
          row={openProvider}
          active={local.some(
            (x) => x.slug === openProvider.slug && x.listingId === openProvider.slug,
          )}
          onClose={() => setOpenProvider(null)}
          onTogglePin={() => toggleFavorite(entryFor(openProvider))}
        />
      ) : null}
    </div>
  );
}

function DiscoverRowCard({
  row,
  active,
  onTogglePin,
  onOpenEndpoints,
}: {
  row: DiscoverRow;
  active: boolean;
  onTogglePin: () => void;
  onOpenEndpoints: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elev/30">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1 pr-3">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{row.title}</span>
            <span
              className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                row.source === 'leash' ? 'bg-brand/15 text-brand' : 'bg-fg-muted/15 text-fg-muted'
              }`}
            >
              {sourceLabel(row.source)}
            </span>
          </div>
          <div className="text-xs text-fg-muted font-mono truncate">{row.slug}</div>
          {row.description ? (
            <div className="text-xs text-fg-muted mt-1 line-clamp-2">{row.description}</div>
          ) : null}
          <div className="text-[11px] text-fg-muted mt-1">{priceLabel(row)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {row.source === 'pay-skills' ? (
            <button
              type="button"
              onClick={onOpenEndpoints}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-bg-elev hover:bg-brand/10"
            >
              Endpoints
            </button>
          ) : null}
          <button
            type="button"
            className={`text-sm px-3 py-1.5 rounded-lg ${active ? 'bg-brand/20 text-brand' : 'bg-bg-elev hover:bg-brand/10'}`}
            onClick={onTogglePin}
          >
            {active ? 'Pinned' : 'Pin'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EndpointsModal({
  row,
  active,
  onClose,
  onTogglePin,
}: {
  row: DiscoverRow;
  active: boolean;
  onClose: () => void;
  onTogglePin: () => void;
}) {
  const { data, error, isLoading } = useSWR<PaySkillsProviderResp | null>(
    row.source === 'pay-skills' ? `/api/pay-skills/${row.slug}` : null,
    endpointsFetcher,
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

  const endpoints = data?.endpoints ?? [];
  const description = row.description;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="endpoints-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl max-h-[90vh] sm:max-h-[80vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-border bg-bg-elev shadow-2xl">
        <div className="shrink-0 flex items-start gap-3 border-b border-border p-4 sm:p-5">
          <div className="size-11 rounded-lg bg-bg-elev-2 shrink-0 grid place-items-center text-xs font-mono text-fg-subtle uppercase">
            {row.slug.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="endpoints-modal-title"
              className="text-base sm:text-lg font-semibold tracking-tight truncate"
            >
              {row.title}
            </h2>
            <div className="text-[11px] sm:text-xs text-fg-subtle font-mono truncate">
              {row.slug}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  row.source === 'leash' ? 'bg-brand/15 text-brand' : 'bg-fg-muted/15 text-fg-muted'
                }`}
              >
                {sourceLabel(row.source)}
              </span>
              <span className="rounded-full bg-bg-elev-2 text-fg-muted px-2 py-0.5 text-[10px] font-medium">
                {priceLabel(row)}
              </span>
            </div>
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
                Endpoints
              </h3>
              {endpoints.length > 0 ? (
                <span className="text-xs text-fg-muted font-mono">{endpoints.length}</span>
              ) : null}
            </div>

            {error ? (
              <div className="text-sm text-danger">Could not load endpoints for this provider.</div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted py-4">
                <Spinner size="sm" />
                Loading endpoints
              </div>
            ) : !data ? (
              <div className="text-sm text-danger">
                Couldn’t load endpoints (try again — pay-skills upstream is occasionally slow).
              </div>
            ) : endpoints.length === 0 ? (
              <p className="text-sm text-fg-muted">No published endpoints.</p>
            ) : (
              <ul className="space-y-2">
                {endpoints.map((ep, i) => (
                  <li
                    key={`${ep.method}-${ep.url}-${i}`}
                    className="rounded-lg border border-border bg-bg/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="font-mono uppercase text-fg-muted text-xs">
                            {ep.method}
                          </span>
                          <span className="truncate" title={ep.url}>
                            {ep.url}
                          </span>
                        </div>
                        {ep.description ? (
                          <p className="mt-1 text-xs text-fg-muted leading-snug line-clamp-3">
                            {ep.description}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-bg-elev-2 text-fg-muted px-2 py-0.5 text-[10px]">
                        {endpointPrice(ep)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-fg-muted">
                      {(ep.protocol ?? []).map((p) => (
                        <span key={p} className="px-1.5 py-0.5 rounded bg-bg-elev">
                          {p}
                        </span>
                      ))}
                      {(ep.supported_usd ?? []).map((s) => (
                        <span key={s} className="px-1.5 py-0.5 rounded bg-brand/10 text-brand">
                          {s}
                        </span>
                      ))}
                      {ep.probe_status ? (
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            ep.probe_status === 'ok' ? 'bg-fg-muted/10' : 'bg-danger/15 text-danger'
                          }`}
                        >
                          probe: {ep.probe_status}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border p-3 sm:p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-fg-muted">
            Pay any URL with <code className="font-mono">leash_pay_payment_link</code> or{' '}
            <code className="font-mono">buyer-kit</code>.
          </div>
          <button
            type="button"
            onClick={onTogglePin}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active ? 'bg-brand/20 text-brand' : 'bg-brand text-white hover:bg-brand-strong'
            }`}
          >
            {active ? 'Pinned' : 'Pin'}
          </button>
        </div>
      </div>
    </div>
  );
}

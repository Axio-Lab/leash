'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';

import {
  EMPTY_DRAFT,
  isDraftComplete,
  manifestToDraft,
  slugify,
  type ListingDraft,
  type ManifestImport,
} from '@/lib/listing-helper';
import { privyAuthedFetch } from '@/lib/privy-fetch';

type ImportResp = { manifest: ManifestImport } | { error: string; message?: string };

export default function ListNewListingPage() {
  const router = useRouter();
  const { getAccessToken } = usePrivy();
  const [stage, setStage] = React.useState<'paste' | 'review'>('paste');
  const [url, setUrl] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ListingDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = React.useState(false);

  async function importFromUrl(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setImporting(true);
    try {
      const res = await privyAuthedFetch(getAccessToken, '/api/listings/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = (await res.json()) as ImportResp;
      if (!res.ok || !('manifest' in body)) {
        throw new Error('message' in body && body.message ? body.message : 'import failed');
      }
      setDraft(manifestToDraft(body.manifest));
      setStage('review');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await privyAuthedFetch(getAccessToken, '/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: draft.slug,
          name: draft.name,
          description: draft.description,
          category: draft.category,
          endpoint: draft.endpoint,
          pricing: draft.pricing,
          tools: draft.tools,
          ...(draft.docsUrl ? { docs_url: draft.docsUrl } : {}),
          ...(draft.freeTier > 0 ? { free_tier: draft.freeTier } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      router.push('/dev/listings?submitted=1');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === 'paste') {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">List a tool</h1>
          <p className="text-fg-muted text-sm mt-1">
            Paste your `/.well-known/leash-mcp.json` URL and we'll import the manifest. You can
            review and tweak before submitting for approval.
          </p>
        </div>
        <form onSubmit={importFromUrl} className="space-y-3 rounded-lg border bg-bg-elev p-5">
          <label className="block text-sm">
            <span className="text-fg-muted text-xs">Manifest URL</span>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://search.example.com/.well-known/leash-mcp.json"
              className="mt-1 w-full rounded-md border bg-bg px-3 py-2 font-mono text-xs"
            />
          </label>
          {error ? <div className="text-danger text-xs">{error}</div> : null}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={importing || url.length === 0}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {importing ? 'Importing…' : 'Import manifest'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review listing</h1>
        <p className="text-fg-muted text-sm mt-1">
          We pulled the manifest. Tweak the fields, then submit for approval.
        </p>
      </div>
      <div className="rounded-lg border bg-bg-elev p-5 space-y-3">
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                name: e.target.value,
                slug: d.slug || slugify(e.target.value),
              }))
            }
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Slug">
          <input
            type="text"
            value={draft.slug}
            onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            rows={3}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Category">
          <input
            type="text"
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Endpoint">
          <input
            type="url"
            value={draft.endpoint}
            onChange={(e) => setDraft((d) => ({ ...d, endpoint: e.target.value }))}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono text-xs"
          />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-xs text-fg-muted">Pricing</legend>
          <div className="flex gap-2 flex-wrap">
            {(['free', 'per_call', 'variable'] as const).map((t) => (
              <label key={t} className="text-xs flex items-center gap-1">
                <input
                  type="radio"
                  checked={draft.pricing.type === t}
                  onChange={() => setDraft((d) => ({ ...d, pricing: { ...d.pricing, type: t } }))}
                />
                {t}
              </label>
            ))}
          </div>
          {draft.pricing.type !== 'free' ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="0.001"
                value={draft.pricing.amount ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, pricing: { ...d.pricing, amount: e.target.value } }))
                }
                className="flex-1 rounded-md border bg-bg px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="USDC"
                value={draft.pricing.currency ?? 'USDC'}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, pricing: { ...d.pricing, currency: e.target.value } }))
                }
                className="w-32 rounded-md border bg-bg px-3 py-2 text-sm"
              />
            </div>
          ) : null}
        </fieldset>
        <Field label="Tools">
          <ul className="text-xs text-fg-muted divide-y rounded-md border bg-bg">
            {draft.tools.length === 0 ? (
              <li className="px-3 py-3 text-fg-subtle">No tools detected.</li>
            ) : (
              draft.tools.map((t) => (
                <li key={t.name} className="px-3 py-2 flex items-start gap-3">
                  <code className="text-brand">{t.name}</code>
                  <span>{t.description}</span>
                </li>
              ))
            )}
          </ul>
        </Field>
      </div>
      {error ? <div className="text-danger text-xs">{error}</div> : null}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStage('paste')}
          className="rounded-md border px-3 py-2 text-sm hover:border-border-strong"
        >
          ← Re-import
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !isDraftComplete(draft)}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit for approval'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm space-y-1">
      <span className="text-fg-muted text-xs">{label}</span>
      {children}
    </label>
  );
}

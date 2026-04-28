'use client';

import * as React from 'react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{
    items: Array<{ id: string; privy_id: string; body: string; created_at: string }>;
  }>;
};

/**
 * Listing detail review block. Anyone signed in can post a review
 * (~payment-gated review enforcement is server-side, plan §day9). One
 * rating per (listing, user); subsequent ratings overwrite the previous.
 */
export function ReviewBlock({ listingId }: { listingId: string }) {
  const { authenticated, login } = usePrivy();
  const [stars, setStars] = React.useState<number>(5);
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reviews = useSWR(`/api/listings/${listingId}/reviews`, fetcher);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/listings/${listingId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stars }),
      });
      if (!r.ok) throw new Error('failed to save rating');
      if (body.trim().length > 0) {
        const r2 = await fetch(`/api/listings/${listingId}/reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ body }),
        });
        if (!r2.ok) throw new Error('failed to save review');
      }
      setBody('');
      reviews.mutate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border bg-bg-elev p-5 space-y-4">
      <h2 className="text-sm font-medium">Reviews</h2>
      {!authenticated ? (
        <button
          type="button"
          onClick={login}
          className="text-xs rounded-md border px-3 py-1.5 hover:border-border-strong"
        >
          Sign in to rate or review
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStars(s)}
                className={s <= stars ? 'text-amber-300' : 'text-fg-subtle'}
              >
                ★
              </button>
            ))}
            <span className="text-xs text-fg-muted ml-2">{stars} / 5</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Optional: share what worked (or didn't)…"
            maxLength={2000}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
          />
          {error ? <div className="text-danger text-xs">{error}</div> : null}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Submit'}
            </button>
          </div>
        </form>
      )}
      <ul className="space-y-3">
        {reviews.data?.items.length === 0 ? (
          <li className="text-xs text-fg-muted">No reviews yet.</li>
        ) : (
          (reviews.data?.items.map((r) => (
            <li key={r.id} className="border-t pt-3 first:border-0 first:pt-0">
              <div className="text-xs text-fg-muted">
                <span className="font-mono">{r.privy_id.slice(0, 12)}…</span> ·{' '}
                {new Date(r.created_at).toLocaleDateString()}
              </div>
              <div className="text-sm mt-1 whitespace-pre-line">{r.body}</div>
            </li>
          )) ?? null)
        )}
      </ul>
    </div>
  );
}

import {
  createLeashAdminClient,
  type LeashAdminClient,
} from '@leashmarket/platform-auth/leash-client';

import { getServerEnv } from './env';

let cached: LeashAdminClient | null = null;

/**
 * Returns the typed Leash admin client used by every BFF route to issue
 * / list / revoke `lsh_*` keys.
 */
export function getLeash(): LeashAdminClient {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createLeashAdminClient({
    baseUrl: env.leashApiUrl,
    adminSecret: env.leashApiAdminSecret,
  });
  return cached;
}

/**
 * Thin fetch wrapper for `/v1/marketplace/*` routes. Browse and detail
 * are public; everything else relies on the admin secret carried by the
 * BFF.
 */
async function go<T>(path: string, init?: RequestInit, withAdmin = false): Promise<T> {
  const env = getServerEnv();
  const headers = new Headers(init?.headers);
  if (withAdmin) headers.set('authorization', `Bearer ${env.leashApiAdminSecret}`);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  const res = await fetch(`${env.leashApiUrl}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: 'invalid_response', message: text };
    }
  }
  if (!res.ok) {
    const code =
      (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : null) ?? `http_${res.status}`;
    const message =
      (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : null) ?? res.statusText;
    const err = new Error(message);
    (err as { status?: number }).status = res.status;
    (err as { code?: string }).code = code;
    throw err;
  }
  return body as T;
}

export const leashMarketplace = {
  discover: (q: URLSearchParams) =>
    go<{ items: unknown[]; next_cursor: string | null }>(`/v1/discover?${q.toString()}`),
  listPlatformAgents: (ownerPrivyId: string) =>
    go<{ items: unknown[] }>(
      `/v1/platform/agents?owner_privy_id=${encodeURIComponent(ownerPrivyId)}`,
      undefined,
      true,
    ),
  paySkillsProvider: (fqn: string) =>
    go<unknown>(
      `/v1/discover/pay-skills/${fqn
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/')}`,
    ),
  listListings: (q: URLSearchParams) =>
    go<{ items: unknown[] }>(`/v1/marketplace/listings?${q.toString()}`),
  getListing: (slug: string) =>
    go<{
      listing: unknown;
      rating: { avg: number; count: number };
      identity_verification: unknown;
    }>(`/v1/marketplace/listings/${encodeURIComponent(slug)}`),
  createListing: (body: unknown) =>
    go<unknown>('/v1/marketplace/listings', { method: 'POST', body: JSON.stringify(body) }, true),
  fromUrl: (url: string) =>
    go<{ manifest: unknown }>(
      '/v1/marketplace/listings/from-url',
      { method: 'POST', body: JSON.stringify({ url }) },
      true,
    ),
  listReviews: (id: string) => go<{ items: unknown[] }>(`/v1/marketplace/listings/${id}/reviews`),
  addReview: (id: string, body: unknown) =>
    go<unknown>(
      `/v1/marketplace/listings/${id}/reviews`,
      { method: 'POST', body: JSON.stringify(body) },
      true,
    ),
  rate: (id: string, body: unknown) =>
    go<unknown>(
      `/v1/marketplace/listings/${id}/rating`,
      { method: 'POST', body: JSON.stringify(body) },
      true,
    ),
  setStatus: (id: string, body: unknown) =>
    go<unknown>(
      `/v1/marketplace/listings/${id}/status`,
      { method: 'PATCH', body: JSON.stringify(body) },
      true,
    ),
};

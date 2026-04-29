/**
 * Links to Leash explorer (explorer.leash.market).
 */

import { NEXT_PUBLIC_EXPLORER_URL as ENV_EXPLORER } from './env';

const EXPLORER_BASE: string = ENV_EXPLORER.replace(/\/+$/, '');

export function explorerBase(): string {
  return EXPLORER_BASE;
}

export function receiptUrl(hash: string): string {
  const h = encodeURIComponent(hash.trim());
  return `${EXPLORER_BASE}/receipt/${h}`;
}

/** Agent mint address page */
export function agentUrl(mint: string): string {
  const m = encodeURIComponent(mint.trim());
  return `${EXPLORER_BASE}/agent/${m}`;
}

export function txUrl(sig: string): string {
  const s = encodeURIComponent(sig.trim());
  return `${EXPLORER_BASE}/tx/${s}`;
}

export function eventUrl(id: string): string {
  const i = encodeURIComponent(id.trim());
  return `${EXPLORER_BASE}/event/${i}`;
}

export function shortHash(hash: string, head = 6, tail = 4): string {
  const h = hash.trim();
  if (h.length <= head + tail) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

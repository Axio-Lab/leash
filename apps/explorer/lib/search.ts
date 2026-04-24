/**
 * Resolve free-form search input to a route on the active network.
 *
 * Heuristics (in order):
 *   - looks like a base58 32-byte pubkey  → try /agent/<v> first, fall back to /address/<v>
 *   - looks like a base58 ~88-char tx sig → /tx/<v>
 *   - 64 hex chars                        → /receipt/<v>
 *   - ULID-like (26 base32 chars)         → /event/<v>
 *
 * The actual existence check happens in the destination page; this
 * resolver is intentionally syntactic so we never block on a network
 * round-trip in middleware.
 */

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_TX = /^[1-9A-HJ-NP-Za-km-z]{60,128}$/;
const HEX_RECEIPT = /^[0-9a-f]{64}$/i;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export type SearchHit =
  | { kind: 'agent'; value: string }
  | { kind: 'tx'; value: string }
  | { kind: 'receipt'; value: string }
  | { kind: 'event'; value: string }
  | { kind: 'unknown'; value: string };

export function resolveSearch(raw: string): SearchHit {
  const v = raw.trim();
  if (!v) return { kind: 'unknown', value: '' };
  if (HEX_RECEIPT.test(v)) return { kind: 'receipt', value: v.toLowerCase() };
  if (ULID.test(v)) return { kind: 'event', value: v.toUpperCase() };
  if (BASE58_PUBKEY.test(v) && v.length <= 44) return { kind: 'agent', value: v };
  if (BASE58_TX.test(v)) return { kind: 'tx', value: v };
  return { kind: 'unknown', value: v };
}

export function searchHitToHref(hit: SearchHit): string {
  switch (hit.kind) {
    case 'agent':
      return `/agent/${encodeURIComponent(hit.value)}`;
    case 'tx':
      return `/tx/${encodeURIComponent(hit.value)}`;
    case 'receipt':
      return `/receipt/${encodeURIComponent(hit.value)}`;
    case 'event':
      return `/event/${encodeURIComponent(hit.value)}`;
    case 'unknown':
      return `/search?q=${encodeURIComponent(hit.value)}`;
  }
}

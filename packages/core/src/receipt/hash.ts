import { createHash } from 'node:crypto';

export function requestHash(input: {
  method: string;
  url: string;
  body: string | null;
  headers?: Record<string, string>;
}): string {
  const h = createHash('sha256');
  h.update(input.method);
  h.update('\n');
  h.update(input.url);
  h.update('\n');
  h.update(input.body ?? '');
  h.update('\n');
  if (input.headers) {
    const keys = Object.keys(input.headers).sort();
    for (const k of keys) {
      h.update(k);
      h.update('=');
      h.update(String(input.headers[k]));
      h.update('\n');
    }
  }
  return `sha256:${h.digest('hex')}`;
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Stable JSON stringify with sorted keys (shallow + deep for plain objects). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeys(obj[k]);
  }
  return out;
}

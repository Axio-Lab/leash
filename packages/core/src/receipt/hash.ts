import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Synchronous SHA-256 via `@noble/hashes` so receipts can be hashed in
 * Node, in the browser (Privy buyer), and in workers without depending
 * on `node:crypto` or async `crypto.subtle`.
 */
export function requestHash(input: {
  method: string;
  url: string;
  body: string | null;
  headers?: Record<string, string>;
}): string {
  const parts: string[] = [input.method, input.url, input.body ?? ''];
  if (input.headers) {
    const keys = Object.keys(input.headers).sort();
    for (const k of keys) {
      parts.push(`${k}=${String(input.headers[k])}`);
    }
  }
  const concatenated = `${parts.join('\n')}\n`;
  return `sha256:${bytesToHex(sha256(utf8ToBytes(concatenated)))}`;
}

export function sha256Hex(data: string): string {
  return bytesToHex(sha256(utf8ToBytes(data)));
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

/**
 * Storage helpers for the content-addressable `image_blobs` table.
 *
 * We store small images (agent avatars, listing thumbnails) as raw
 * BLOBs keyed by sha256 of the bytes. Inserts are idempotent — the
 * same bytes always resolve to the same hash, so repeat uploads are
 * a no-op.
 *
 * Bytes are exposed publicly via `GET /v1/uploads/{hash}`; that route
 * sets the persisted `mime` as `Content-Type` so callers can use the
 * URL as an `<img src>` directly.
 */

import { createHash } from 'node:crypto';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';

export type ImageBlobRow = {
  hash: string;
  mime: string;
  bytes: Uint8Array;
  size: number;
  createdAt: string;
};

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

const MAX_BYTES = 1_500_000; // 1.5 MiB — keeps libsql round-trips cheap.

export class ImageTooLargeError extends Error {
  readonly limit = MAX_BYTES;
  constructor(public readonly size: number) {
    super(`image is ${size} bytes; limit is ${MAX_BYTES}`);
    this.name = 'ImageTooLargeError';
  }
}

export class UnsupportedMimeError extends Error {
  constructor(public readonly mime: string) {
    super(`unsupported mime type "${mime}"`);
    this.name = 'UnsupportedMimeError';
  }
}

/**
 * Decode a `data:<mime>;base64,<…>` URL into raw bytes + the declared
 * mime type. Returns `null` for malformed or non-base64 data URLs.
 */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1]!.toLowerCase();
  try {
    const bytes = Buffer.from(match[2]!, 'base64');
    return { mime, bytes: new Uint8Array(bytes) };
  } catch {
    return null;
  }
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function putImageBlob(
  db: DbClient,
  args: { mime: string; bytes: Uint8Array },
): Promise<{ hash: string; size: number; mime: string }> {
  const mime = args.mime.toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) throw new UnsupportedMimeError(mime);
  if (args.bytes.byteLength > MAX_BYTES) throw new ImageTooLargeError(args.bytes.byteLength);
  const hash = hashBytes(args.bytes);
  await execute(
    db,
    `INSERT OR IGNORE INTO image_blobs (hash, mime, bytes, size) VALUES (?, ?, ?, ?)`,
    [hash, mime, args.bytes, args.bytes.byteLength],
  );
  return { hash, size: args.bytes.byteLength, mime };
}

export async function getImageBlob(db: DbClient, hash: string): Promise<ImageBlobRow | null> {
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  const res = await execute(
    db,
    `SELECT hash, mime, bytes, size, created_at FROM image_blobs WHERE hash = ? LIMIT 1`,
    [hash],
  );
  const row = res.rows[0];
  if (!row) return null;
  const r = row as Record<string, unknown>;
  // libsql returns BLOBs as Uint8Array (Node) or ArrayBuffer-likes; normalise.
  const raw = r.bytes;
  let bytes: Uint8Array;
  if (raw instanceof Uint8Array) {
    bytes = raw;
  } else if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw);
  } else if (typeof raw === 'string') {
    // libsql HTTP transport returns blobs as base64 strings.
    bytes = new Uint8Array(Buffer.from(raw, 'base64'));
  } else {
    bytes = new Uint8Array(0);
  }
  return {
    hash: String(r.hash),
    mime: String(r.mime),
    bytes,
    size: Number(r.size ?? bytes.byteLength),
    createdAt: String(r.created_at),
  };
}

export const IMAGE_LIMITS = {
  maxBytes: MAX_BYTES,
  allowedMimes: [...ALLOWED_MIMES],
};

/**
 * HMAC signing for outbound webhook deliveries.
 *
 * Header format (Stripe-compatible):
 *   X-Leash-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
 *
 * The signed payload is `${t}.${rawBody}` so receivers can verify
 * timestamp + body without re-encoding JSON.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureParts = {
  timestamp: number;
  signature: string;
  header: string;
};

export function signPayload(secret: string, body: string, now = Date.now()): SignatureParts {
  const timestamp = Math.floor(now / 1000);
  const signature = hmacHex(secret, `${timestamp}.${body}`);
  return {
    timestamp,
    signature,
    header: `t=${timestamp},v1=${signature}`,
  };
}

export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  const parts = parseHeader(header);
  if (!parts) return false;
  const ageSeconds = Math.abs(Math.floor(now / 1000) - parts.timestamp);
  if (ageSeconds > toleranceSeconds) return false;
  const expected = hmacHex(secret, `${parts.timestamp}.${body}`);
  return timingEqual(expected, parts.signature);
}

function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function parseHeader(header: string): { timestamp: number; signature: string } | null {
  const map = new Map<string, string>();
  for (const segment of header.split(',')) {
    const [k, v] = segment.split('=');
    if (k && v) map.set(k.trim(), v.trim());
  }
  const t = map.get('t');
  const v1 = map.get('v1');
  if (!t || !v1) return null;
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, signature: v1 };
}

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

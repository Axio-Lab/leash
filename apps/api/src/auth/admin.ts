/**
 * Admin authentication middleware.
 *
 * Gates the `/v1/admin/*` surface (currently: API key issuance) on a
 * single shared secret read from `LEASH_API_ADMIN_SECRET`. The secret
 * is sent as `Authorization: Bearer <secret>` or `X-Admin-Secret`,
 * and compared in constant time so timing attacks cannot probe it.
 *
 * The admin routes are ALWAYS mounted so they show up in `/openapi.json`
 * and Swagger UI under `Authorize → AdminSecret`. If the operator has
 * not configured `LEASH_API_ADMIN_SECRET` on this server, every request
 * is rejected with 503 instead of 401 — this makes "secret not wired
 * up yet" distinguishable from "wrong secret".
 */

import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

import { ApiError } from '../util/errors.js';
import { jsonError, unauthorized } from '../util/errors.js';

function extractSecret(
  headerAuth: string | undefined,
  headerDirect: string | undefined,
): string | null {
  if (headerAuth && /^bearer\s+/i.test(headerAuth)) {
    return headerAuth.replace(/^bearer\s+/i, '').trim();
  }
  return headerDirect?.trim() || null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // timingSafeEqual throws on length mismatch; do a fixed-length
    // dummy compare so we still take similar time.
    const pad = Buffer.alloc(ab.length, 0);
    timingSafeEqual(ab, pad);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function adminAuth(secret: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!secret) {
      return jsonError(
        c,
        new ApiError({
          code: 'forbidden',
          status: 503,
          message:
            'admin endpoints are visible in the API spec but disabled on this server. ' +
            'Set LEASH_API_ADMIN_SECRET in the env to enable them.',
        }),
      );
    }
    const provided = extractSecret(c.req.header('authorization'), c.req.header('x-admin-secret'));
    if (!provided) return jsonError(c, unauthorized('missing admin secret'));
    if (!safeEqual(provided, secret)) {
      return jsonError(c, unauthorized('invalid admin secret'));
    }
    await next();
  };
}

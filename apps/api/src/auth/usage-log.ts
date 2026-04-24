/**
 * Per-request usage logger.
 *
 * Runs after `apiKeyAuth` so `c.var.apiKey` is populated; writes one
 * row to `api_requests` for every authenticated request once the
 * downstream handler has finished. Failures to log are intentionally
 * swallowed — usage logging must never fail the underlying API call.
 *
 * Powers `GET /v1/metrics/usage` and the operator dashboards.
 */

import type { MiddlewareHandler } from 'hono';

import type { DbClient } from '../storage/turso.js';
import { execute } from '../storage/turso.js';
import type { AuthVariables } from './types.js';

export function usageLogger(deps: {
  db: DbClient;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const start = Date.now();
    let status = 0;
    let errorCode: string | null = null;
    try {
      await next();
      status = c.res.status;
      if (status >= 400) {
        try {
          const cloned = c.res.clone();
          const body = (await cloned.json()) as { error?: string };
          errorCode = typeof body.error === 'string' ? body.error : null;
        } catch {
          errorCode = null;
        }
      }
    } catch (err) {
      status = 500;
      errorCode = 'internal';
      throw err;
    } finally {
      const latency = Date.now() - start;
      const apiKey = c.var.apiKey;
      if (apiKey) {
        // Strip query string before storing so paths roll up cleanly.
        const fullPath = c.req.path;
        const cleanPath = fullPath.split('?')[0] ?? fullPath;
        try {
          await execute(
            deps.db,
            `INSERT INTO api_requests
               (api_key_id, network, method, path, status, latency_ms, error_code, client_reference)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              apiKey.id,
              c.var.network,
              c.req.method,
              cleanPath,
              status,
              latency,
              errorCode,
              c.var.clientReference ?? null,
            ],
          );
        } catch {
          // never block requests on usage logging
        }
      }
    }
  };
}

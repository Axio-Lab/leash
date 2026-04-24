/**
 * Hono+OpenAPI app builder for `@leash/api`.
 *
 * Composes:
 *   - public health/version routes (no auth)
 *   - the API key auth middleware
 *   - all `prepare*` routes (identity, executive, delegation, treasury,
 *     token), the read routes, submit, and event lookup
 *   - the OpenAPI 3.1 doc at `/openapi.json`
 *   - JSON error handler that always returns the `{ error, message }`
 *     shape, even for unexpected exceptions
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import { apiKeyAuth, type AuthDeps } from './auth/api-key.js';
import { usageLogger } from './auth/usage-log.js';
import type { AuthVariables } from './auth/types.js';
import { ApiError, internal, jsonError } from './util/errors.js';
import { mountOpenApi } from './openapi/doc.js';
import { buildHealthRoutes } from './routes/health.js';
import { buildIdentityRoutes } from './routes/identity.js';
import { buildExecutiveRoutes } from './routes/executive.js';
import { buildDelegationRoutes } from './routes/delegation.js';
import { buildTreasuryRoutes } from './routes/treasury.js';
import { buildTokenRoutes } from './routes/token.js';
import { buildAgentRoutes } from './routes/agents.js';
import { buildSubmitRoutes } from './routes/submit.js';
import { buildEventRoutes } from './routes/events.js';
import { buildReceiptRoutes } from './routes/receipts.js';
import { buildIndexerRoutes } from './routes/indexer.js';
import { buildWebhookRoutes } from './routes/webhooks.js';
import { buildMetricsRoutes } from './routes/metrics.js';

export type CreateLeashApiArgs = AuthDeps;

export function createLeashApiApp(deps: CreateLeashApiArgs): OpenAPIHono {
  const app = new OpenAPIHono();

  // Centralised JSON error responder. zod-openapi already handles
  // request-validation 400/422; this catches anything else routes throw.
  app.onError((err, c) => {
    if (err instanceof ApiError) return jsonError(c, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(c, internal('unexpected error', message));
  });

  // Mount unauthenticated routes (health + OpenAPI doc + Swagger UI)
  // BEFORE the authed sub-app so its catch-all auth middleware doesn't
  // shadow the public surface.
  app.route('/', buildHealthRoutes());
  mountOpenApi(app);

  const authed = new OpenAPIHono<{ Variables: AuthVariables }>();
  authed.use('*', apiKeyAuth(deps));
  authed.use('*', usageLogger({ db: deps.db }));
  authed.route('/', buildAgentRoutes(deps));
  authed.route('/', buildIdentityRoutes(deps));
  authed.route('/', buildExecutiveRoutes(deps));
  authed.route('/', buildDelegationRoutes(deps));
  authed.route('/', buildTreasuryRoutes(deps));
  authed.route('/', buildTokenRoutes(deps));
  authed.route('/', buildSubmitRoutes(deps));
  authed.route('/', buildEventRoutes(deps));
  authed.route('/', buildReceiptRoutes(deps));
  authed.route('/', buildIndexerRoutes(deps));
  authed.route('/', buildWebhookRoutes(deps));
  authed.route('/', buildMetricsRoutes(deps));
  app.route('/', authed);

  return app;
}

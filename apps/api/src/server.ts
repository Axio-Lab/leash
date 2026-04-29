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
import { buildStatsRoutes } from './routes/stats.js';
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
import { buildAdminRoutes } from './routes/admin.js';
import { buildMarketplaceRoutes } from './routes/marketplace.js';
import { buildPlatformAgentRoutes } from './routes/platform-agents.js';
import { buildPlatformTaskRoutes } from './routes/platform-tasks.js';
import { buildPaymentLinkRoutes } from './routes/payment-links.js';
import { buildPaywallRoutes } from './routes/paywall.js';
import { buildSellerUtilsRoutes } from './routes/seller-utils.js';
import { buildBuyerRoutes } from './routes/buyer.js';
import { buildPublicUploadRoutes, buildUploadRoutes } from './routes/uploads.js';

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

  // Mount unauthenticated routes (health + OpenAPI doc + optional
  // Swagger UI) BEFORE the authed sub-app so its catch-all auth
  // middleware doesn't shadow the public surface.
  app.route('/', buildHealthRoutes());
  app.route('/', buildStatsRoutes({ config: deps.config, db: deps.db, cache: deps.cache }));
  mountOpenApi(app, deps.config);

  // Admin routes use their own secret-based auth. They're always
  // mounted (so they appear in the OpenAPI doc and Swagger UI) but the
  // middleware returns 503 when LEASH_API_ADMIN_SECRET is not set.
  // Mounted BEFORE the user-key sub-app so its API key middleware
  // doesn't intercept admin requests.
  app.route('/', buildAdminRoutes({ config: deps.config, db: deps.db, cache: deps.cache }));
  app.route('/', buildPlatformAgentRoutes({ config: deps.config, db: deps.db, cache: deps.cache }));
  app.route('/', buildPlatformTaskRoutes({ config: deps.config, db: deps.db, cache: deps.cache }));
  app.route('/', buildMarketplaceRoutes({ config: deps.config, db: deps.db, cache: deps.cache }));
  app.route('/', buildUploadRoutes({ config: deps.config, db: deps.db }));
  app.route('/', buildPublicUploadRoutes({ config: deps.config, db: deps.db }));

  // Public x402 paywall (`GET/POST /x/{id}`). Anonymous buyers must
  // be able to reach this without an API key, so it's mounted BEFORE
  // the authed sub-app. It also intentionally does not appear in the
  // OpenAPI doc — it's a protocol surface, not a JSON API.
  app.route('/', buildPaywallRoutes(deps));

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
  authed.route('/', buildPaymentLinkRoutes(deps));
  authed.route('/', buildSellerUtilsRoutes(deps));
  authed.route('/', buildBuyerRoutes(deps));
  app.route('/', authed);

  return app;
}

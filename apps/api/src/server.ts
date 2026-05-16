/**
 * Hono+OpenAPI app builder for `@leashmarket/api`.
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

import './util/suppress-libsignal-console.js';

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
import { buildPlatformAutomationRoutes } from './routes/platform-automations.js';
import { buildPlatformTaskRoutes } from './routes/platform-tasks.js';
import { buildAgentSelfRegisterRoutes } from './routes/agent-self-register.js';
import { buildDiscoverReputationRoutes } from './routes/discover-reputation.js';
import { buildAgentWebhookRoutes } from './routes/agent-webhooks.js';
import { buildPaymentLinkRoutes } from './routes/payment-links.js';
import { buildPaywallRoutes } from './routes/paywall.js';
import { buildSellerUtilsRoutes } from './routes/seller-utils.js';
import { buildBuyerRoutes } from './routes/buyer.js';
import { buildPublicUploadRoutes, buildUploadRoutes } from './routes/uploads.js';
import {
  buildExternalPublicRoutes,
  buildExternalRoutes,
  type ExternalRoutesDeps,
} from './routes/external.js';
import { getWhatsAppManager } from './external/whatsapp-manager.js';
import { dispatchWhatsAppMessage } from './external/whatsapp-dispatcher.js';
import { listWhatsAppConnectionIdsForSessionResume } from './storage/external-connections.js';

export type CreateLeashApiArgs = AuthDeps & {
  /**
   * Optional Telegram-dispatcher overrides for tests. Not exposed via
   * any public env / config — production callers leave both unset.
   */
  externalDispatcherBffFetch?: ExternalRoutesDeps['dispatcherBffFetch'];
  externalDispatcherTelegramClientFactory?: ExternalRoutesDeps['dispatcherTelegramClientFactory'];
  /**
   * Optional pre-built WhatsApp manager — used by tests to inject a
   * stubbed Baileys session. Production callers leave this undefined
   * and rely on `LEASH_WHATSAPP_ENABLED=1` to lazily build the
   * default manager.
   */
  externalWhatsAppManager?: ExternalRoutesDeps['whatsapp'];
};

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
  app.route(
    '/',
    buildPlatformAutomationRoutes({ config: deps.config, db: deps.db, cache: deps.cache }),
  );
  app.route('/', buildPlatformTaskRoutes({ config: deps.config, db: deps.db, cache: deps.cache }));
  // External chat bridges (Telegram + WhatsApp). The admin-gated CRUD
  // sub-app is mounted alongside the other platform routes; the public
  // sub-app (approval read + Telegram webhook) is mounted before the
  // authed sub-app for the same reason as the paywall — third-party
  // services and unauthenticated browsers must reach those endpoints.
  // The WhatsApp manager is opt-in (single replica only). Operators
  // set LEASH_WHATSAPP_ENABLED=1 on exactly one apps/api replica;
  // every other replica leaves the manager unset and the
  // `/v1/external/whatsapp/*` routes return 503. Tests can pass a
  // pre-built manager via `externalWhatsAppManager` to bypass the env
  // gate without instantiating Baileys.
  let whatsappManager: ExternalRoutesDeps['whatsapp'] = deps.externalWhatsAppManager;
  if (!whatsappManager && process.env.LEASH_WHATSAPP_ENABLED === '1') {
    whatsappManager = getWhatsAppManager({
      config: deps.config,
      db: deps.db,
      onInboundMessage: async ({ connection, message, fromId, socket, traceId }) => {
        await dispatchWhatsAppMessage(
          { config: deps.config, db: deps.db, cache: deps.cache, socket },
          { connection, message, fromId, traceId },
        ).catch(() => {});
      },
    });
  }

  if (whatsappManager && !deps.externalWhatsAppManager) {
    const wm = whatsappManager;
    void (async () => {
      try {
        const ids = await listWhatsAppConnectionIdsForSessionResume(deps.db);
        if (ids.length === 0) return;
        for (const id of ids) {
          try {
            await wm.start(id);
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch {
        /* ignore */
      }
    })();
  }

  const externalDeps: ExternalRoutesDeps = {
    config: deps.config,
    db: deps.db,
    cache: deps.cache,
    ...(deps.externalDispatcherBffFetch
      ? { dispatcherBffFetch: deps.externalDispatcherBffFetch }
      : {}),
    ...(deps.externalDispatcherTelegramClientFactory
      ? { dispatcherTelegramClientFactory: deps.externalDispatcherTelegramClientFactory }
      : {}),
    ...(whatsappManager ? { whatsapp: whatsappManager } : {}),
  };
  app.route('/', buildExternalRoutes(externalDeps));
  app.route('/', buildExternalPublicRoutes(externalDeps));
  // Public agent-onboarding routes — `/v1/agents/self-register`,
  // `/v1/sandbox/agent`, `/v1/agents/self-register/info`. Mounted before
  // the authed sub-app so the faucet doesn't sit behind an API key.
  app.route(
    '/',
    buildAgentSelfRegisterRoutes({ config: deps.config, db: deps.db, cache: deps.cache }),
  );
  app.route('/', buildMarketplaceRoutes({ config: deps.config, db: deps.db, cache: deps.cache }));
  // Public discover + reputation. Mounted before the authed sub-app so
  // `/v1/discover` and `/v1/agents/:mint/reputation` are reachable without
  // an API key — these are the agent equivalent of "google a service before
  // paying it" and must work for any caller (MCP host, CLI, indexer).
  app.route(
    '/',
    buildDiscoverReputationRoutes({ config: deps.config, db: deps.db, cache: deps.cache }),
  );
  // Agent-keyed webhooks. Mounted before the authed sub-app because
  // the auth model is `X-Leash-Sig` (executive-keypair signature),
  // not the platform API key — standalone-MCP / CLI agents don't have
  // an API key. The route module installs `onChainAuth` itself.
  app.route('/', buildAgentWebhookRoutes({ config: deps.config, db: deps.db }));
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

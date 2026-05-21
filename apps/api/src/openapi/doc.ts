/**
 * Mounts the OpenAPI 3.1 doc at `/openapi.json`, a Swagger UI viewer at
 * `/docs` (assets pulled from the public Swagger UI CDN — no new
 * runtime dep), and a friendly `/` → `/docs` redirect so people who
 * paste `http://localhost:8801` in a browser see something useful
 * instead of an `unauthorized` JSON.
 *
 * The OpenAPI doc itself is the wire contract polyglot SDKs generate
 * from (`openapi-generator-cli` for Python/Go/Rust/Java) and what
 * Mintlify renders for the public reference at docs.leash.market.
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import { LEASH_API_VERSION, type LeashApiConfig } from '../config.js';

const SWAGGER_UI_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5';

const swaggerHtml = (specUrl: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Leash API · Reference</title>
    <link rel="stylesheet" href="${SWAGGER_UI_CDN}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      /* Authorize modal: align the input + button row with the description
         text instead of the default narrow centered layout. */
      .swagger-ui .dialog-ux .modal-ux { max-width: 720px; width: 92%; }
      .swagger-ui .dialog-ux .modal-ux-content { padding: 24px 28px; }
      .swagger-ui .auth-container { padding: 0 0 16px 0; margin: 0 0 16px 0; }
      .swagger-ui .auth-container + .auth-container { border-top: 1px solid #e6e6e6; padding-top: 16px; }
      .swagger-ui .auth-container h4,
      .swagger-ui .auth-container .wrapper { margin-left: 0 !important; padding-left: 0 !important; }
      .swagger-ui .auth-container input[type=text],
      .swagger-ui .auth-container input[type=password] {
        width: 100%;
        max-width: 100%;
        margin: 8px 0 12px 0;
        box-sizing: border-box;
      }
      .swagger-ui .auth-btn-wrapper {
        display: flex;
        justify-content: flex-start;
        gap: 8px;
        padding: 0;
      }
      /* Hide the bottom "Schemas" / models panel (redundant with per-operation docs). */
      .swagger-ui section.models,
      .swagger-ui section.models.is-open { display: none !important; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI_CDN}/swagger-ui-bundle.js" crossorigin></script>
    <script src="${SWAGGER_UI_CDN}/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
      window.addEventListener('load', () => {
        window.ui = SwaggerUIBundle({
          url: '${specUrl}',
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'BaseLayout',
          deepLinking: true,
          persistAuthorization: true,
          defaultModelsExpandDepth: -1,
          defaultModelExpandDepth: -1,
        });
      });
    </script>
  </body>
</html>`;

export function mountOpenApi(
  app: OpenAPIHono,
  config: Pick<LeashApiConfig, 'docsEnabled' | 'host' | 'port'>,
): void {
  // Omit OpenAPI `servers` so Swagger UI resolves "Try it out" against the
  // same origin that served `/openapi.json` (avoids a redundant Servers
  // dropdown and fixes 0.0.0.0 + Railway showing localhost:$PORT). For
  // offline codegen / Mintlify, pass `-i https://api.leash.market/openapi.json`
  // or set the generator `--server-variables` / base URL explicitly.

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Leash API',
      version: LEASH_API_VERSION,
      description:
        'Public Leash API. Mirrors @leashmarket/registry-utils over HTTP using a prepare/send split. ' +
        'Network is selected by API key prefix (`lsh_test_*` => devnet, `lsh_live_*` => mainnet).',
    },
    tags: [
      { name: 'health', description: 'Liveness + version probes (unauthenticated).' },
      { name: 'agents', description: 'Agent identity, treasury, token reads.' },
      { name: 'identity', description: 'Agent identity registration prepares.' },
      { name: 'executive', description: 'Executive registration + delegation prepares.' },
      { name: 'delegation', description: 'SPL spend-delegation prepares.' },
      { name: 'treasury', description: 'Treasury provision/withdraw prepares.' },
      { name: 'token', description: 'Agent → token association prepares.' },
      { name: 'submit', description: 'Signed-transaction broadcast and tracking.' },
      { name: 'events', description: 'Event lifecycle reads.' },
      { name: 'receipts', description: 'x402 receipt ingestion + reads.' },
      { name: 'indexer', description: 'Indexer status (watchlist + cursor health).' },
      { name: 'webhooks', description: 'Outbound webhook subscriptions and deliveries.' },
      {
        name: 'discover',
        description:
          'Public marketplace + reputation reads. No auth required — agents query these to find counterparties before paying.',
      },
      { name: 'metrics', description: 'Per-key usage and event rollups.' },
      {
        name: 'payment-links',
        description:
          'Hosted x402 payment links served by `/x/{id}` for identity-linked paid capabilities. ' +
          'Network-scoped via the API key.',
      },
      {
        name: 'seller-utils',
        description:
          'Read-only seller-kit helpers (`networks`, `facilitator`, `parse-price`, `pay-to`). ' +
          'Mirrors the `@leashmarket/seller-kit` exports for polyglot SDKs and UI dropdowns.',
      },
      {
        name: 'buyer',
        description:
          'Buyer-kit endpoints — quote, policy gate, payment prepare/execute, ' +
          'receipt finalize/verify, and network/currency catalogs. Full HTTP ' +
          'parity with `@leashmarket/buyer-kit` for polyglot SDKs.',
      },
      {
        name: 'admin',
        description:
          'Operator-only API key issuance. Requires the operator secret in ' +
          '`Authorize → AdminSecret` (or `Authorization: Bearer <secret>` / `X-Admin-Secret`). ' +
          'Returns 503 if `LEASH_API_ADMIN_SECRET` is not configured on this server.',
      },
    ],
  });

  // Both security schemes are always advertised so Swagger UI can show
  // their input fields under "Authorize". The admin endpoints will 503
  // until LEASH_API_ADMIN_SECRET is set on the server process.
  app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKey', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Per-customer key. `lsh_test_*` => devnet, `lsh_live_*` => mainnet. ' +
      'Send as `Authorization: Bearer <key>` or `X-Api-Key: <key>`.',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'AdminSecret', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Operator secret for `/v1/admin/*`. Send as `Authorization: Bearer <secret>` ' +
      'or `X-Admin-Secret: <secret>`. Never expose this to end users.',
  });
  // Standalone-MCP / CLI agents authenticate with an ed25519 signature
  // over a canonical request envelope — see /v1/agents/{mint}/webhooks
  // and apps/api/src/auth/onchain.ts. Three headers go together; we
  // declare them as a single security scheme via the `apiKey` flavour
  // because OpenAPI has no first-class "set of cooperating headers".
  app.openAPIRegistry.registerComponent('securitySchemes', 'OnChainSig', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Leash-Sig',
    description:
      'Triple-header on-chain auth: `X-Leash-Agent` (asset mint), `X-Leash-Timestamp` (ISO-8601), ' +
      '`X-Leash-Sig` (base58 ed25519 signature over `${method}\\n${path}\\n${ts}\\n${sha256(body)}\\n${mint}`). ' +
      'Used by `@leashmarket/sdk`, `@leashmarket/cli`, and `@leashmarket/mcp` so agents can hit /v1/agents/{mint}/* without an API key.',
  });

  if (config.docsEnabled) {
    app.get('/docs', (c) =>
      c.html(swaggerHtml('/openapi.json'), 200, {
        'cache-control': 'public, max-age=300',
      }),
    );
    app.get('/', (c) => c.redirect('/docs', 302));
  }
}

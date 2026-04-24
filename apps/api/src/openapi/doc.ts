/**
 * Mounts the OpenAPI 3.1 doc at `/openapi.json` and the auto-generated
 * Swagger UI at `/docs`.
 *
 * The doc is the wire contract polyglot SDKs generate from
 * (`openapi-generator-cli` for Python/Go/Rust/Java) and what Mintlify
 * renders for the public reference at docs.leash.market.
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import { LEASH_API_VERSION } from '../config.js';

export function mountOpenApi(app: OpenAPIHono): void {
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Leash API',
      version: LEASH_API_VERSION,
      description:
        'Public Leash API. Mirrors @leash/registry-utils over HTTP using a prepare/send split. ' +
        'Network is selected by API key prefix (`lsh_test_*` => devnet, `lsh_live_*` => mainnet).',
    },
    servers: [
      { url: 'https://api.leash.market', description: 'Production' },
      { url: 'http://localhost:8801', description: 'Local dev' },
    ],
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
    ],
  });
}

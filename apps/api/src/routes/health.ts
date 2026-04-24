/**
 * Public, unauthenticated health and version endpoints.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { LEASH_API_VERSION } from '../config.js';

export function buildHealthRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/health',
      tags: ['health'],
      summary: 'Liveness probe',
      responses: {
        200: {
          description: 'Server is up.',
          content: {
            'application/json': {
              schema: z.object({ ok: z.literal(true), ts: z.string() }),
            },
          },
        },
      },
    }),
    (c) => c.json({ ok: true as const, ts: new Date().toISOString() }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/version',
      tags: ['health'],
      summary: 'API version',
      responses: {
        200: {
          description: 'Public API version + supported networks.',
          content: {
            'application/json': {
              schema: z.object({
                version: z.string(),
                networks: z.array(z.enum(['solana-devnet', 'solana-mainnet'])),
              }),
            },
          },
        },
      },
    }),
    (c) =>
      c.json({
        version: LEASH_API_VERSION,
        networks: ['solana-devnet', 'solana-mainnet'] satisfies Array<
          'solana-devnet' | 'solana-mainnet'
        >,
      }),
  );

  return app;
}

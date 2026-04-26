/**
 * Public, unauthenticated health and version endpoints.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { resolveLeashFeeAuthority, resolveLeashFeeBps } from '@leash/core';

import { LEASH_API_VERSION } from '../config.js';

const ProtocolFeeBlockSchema = z
  .object({
    bps: z.number().int().min(0).max(10_000),
    pct: z.string(),
    authorities: z.object({
      'solana-mainnet': z.string(),
      'solana-devnet': z.string(),
    }),
  })
  .openapi('ProtocolFeeBlock');

const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    ts: z.string(),
    /**
     * Snapshot of the API server's resolved Leash protocol fee config.
     * Mirrors the `/health` block on `@leash/facilitator`. Buyer SDKs
     * surface this so users can verify the rate before signing.
     */
    protocol_fee: ProtocolFeeBlockSchema,
  })
  .openapi('HealthResponse');

function buildProtocolFeeBlock(): z.infer<typeof ProtocolFeeBlockSchema> {
  const bps = resolveLeashFeeBps();
  return {
    bps,
    pct: `${(bps / 100).toFixed(2)}%`,
    authorities: {
      'solana-mainnet': resolveLeashFeeAuthority('mainnet'),
      'solana-devnet': resolveLeashFeeAuthority('devnet'),
    },
  };
}

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
              schema: HealthResponseSchema,
            },
          },
        },
      },
    }),
    (c) =>
      c.json({
        ok: true as const,
        ts: new Date().toISOString(),
        protocol_fee: buildProtocolFeeBlock(),
      }),
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

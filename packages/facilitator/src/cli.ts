#!/usr/bin/env node
/**
 * `leash-facilitator` — boots a stand-alone Leash facilitator HTTP
 * server. Reads config from env vars; this is what runs behind
 * `https://facilitator.leash.market` in production.
 *
 * Required env:
 *
 *   - `LEASH_FACILITATOR_SECRET_KEY` — JSON-array (Solana CLI export)
 *     **or** base58 64-byte secret. The signer's pubkey is the fee
 *     payer; fund it with SOL on every network you serve.
 *
 * Optional env:
 *
 *   - `LEASH_FACILITATOR_PORT`     — default `8787`
 *   - `LEASH_FACILITATOR_HOST`     — default `0.0.0.0`
 *   - `LEASH_FACILITATOR_NETWORKS` — comma list: `devnet`, `testnet`,
 *                                    `mainnet`. Default `devnet`.
 *   - `LEASH_FACILITATOR_RPC_URL`  — default RPC override (per-network
 *                                    URLs use `@solana/kit` defaults
 *                                    when unset).
 */

import { serve } from '@hono/node-server';

import { createLeashFacilitator, parseNetworksEnv } from './factory.js';

function getRequiredEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    console.error(`[leash-facilitator] missing required env var: ${key}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const secretKey = getRequiredEnv('LEASH_FACILITATOR_SECRET_KEY');
  const networks = parseNetworksEnv(process.env.LEASH_FACILITATOR_NETWORKS);
  const port = Number(process.env.LEASH_FACILITATOR_PORT ?? 8787);
  const host = process.env.LEASH_FACILITATOR_HOST ?? '0.0.0.0';
  const defaultRpcUrl = process.env.LEASH_FACILITATOR_RPC_URL;

  const { app, signer, caip2Networks } = await createLeashFacilitator({
    secretKey,
    networks,
    defaultRpcUrl,
  });

  serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`[leash-facilitator] listening on http://${host}:${info.port}`);
    console.log(`[leash-facilitator] networks: ${caip2Networks.join(', ')}`);
    console.log(`[leash-facilitator] fee payer(s): ${signer.addresses.join(', ')}`);
    if (networks.includes('mainnet')) {
      console.log(
        '[leash-facilitator] WARNING: mainnet enabled — ensure signer is funded with real SOL',
      );
    }
  });
}

main().catch((err) => {
  console.error('[leash-facilitator] fatal startup error:', err);
  process.exit(1);
});

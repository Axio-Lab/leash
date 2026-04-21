import type { Hono } from 'hono';
import type { Context } from '@metaplex-foundation/umi';
import { simpleX402Gate } from './simple-x402.js';
import { resolveSellerPayTo, type AgentSellerConfig } from '../seller/agent-seller.js';

export type SellerRouteConfig = {
  description: string;
  /** Display price e.g. "$0.001" (informational for simple gate). */
  price: string;
};

export type CreateSellerOptions = {
  umi: Pick<Context, 'eddsa' | 'programs'>;
  sellerAgent: AgentSellerConfig;
  routes: Record<string, SellerRouteConfig>;
};

/**
 * Registers x402-shaped payment gate on given route keys (`METHOD /path`).
 * `payTo` is derived as the seller agent's Asset Signer PDA.
 */
export function createSeller(app: Hono, opts: CreateSellerOptions): { payTo: string } {
  const payTo = resolveSellerPayTo(opts.umi, opts.sellerAgent);
  for (const route of Object.keys(opts.routes)) {
    const [method, path] = route.split(/\s+/, 2);
    if (!method || !path) {
      throw new Error(`Invalid route key: ${route}`);
    }
    app.use(path, async (c, next) => {
      if (c.req.method !== method.toUpperCase()) {
        return next();
      }
      return simpleX402Gate()(c, next);
    });
  }
  return { payTo };
}

import type { MiddlewareHandler } from 'hono';

const HEADER = 'x-payment';

/**
 * Minimal x402-shaped gate: 402 without payment header, forwards when present.
 * Swap for `@x402/hono` `paymentMiddleware` + PayAI facilitator in production.
 */
export function simpleX402Gate(): MiddlewareHandler {
  return async (c, next) => {
    if (!c.req.header(HEADER)) {
      return c.json({ error: 'payment_required', protocol: 'x402-shaped' }, 402);
    }
    await next();
  };
}

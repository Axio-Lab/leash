/**
 * Hono app implementing the x402 facilitator HTTP API. Compatible
 * wire-shape with `HTTPFacilitatorClient` from `@x402/core`, so any
 * existing `@leash/seller-kit` / `@leash/buyer-kit` deployment can point
 * at this URL via the `LEASH_FACILITATOR_URL` env var with no other
 * code changes.
 *
 * Endpoints:
 *
 *   - `GET  /health`     — liveness + signer addresses (for monitoring)
 *   - `GET  /supported`  — `{ kinds, extensions, signers }` from the
 *                          underlying `x402Facilitator`
 *   - `POST /verify`     — `{ x402Version, paymentPayload, paymentRequirements }`
 *                          → `VerifyResponse`
 *   - `POST /settle`     — same body shape → `SettleResponse`
 *
 * What this does NOT do (yet — see `apps/docs/guides/run-a-facilitator.mdx`):
 *
 *   - Auth / rate limiting. v0.1 is open. Wrap with a Cloudflare
 *     worker or a reverse-proxy bouncer if you publish the URL.
 *   - Settlement persistence. We don't yet write a `settlements` row to
 *     a database. The explorer cross-source view (Order #6 from the
 *     roadmap) lands once the DB shape is agreed.
 */

import { Hono } from 'hono';
import type { x402Facilitator } from '@x402/core/facilitator';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';

export type CreateFacilitatorHttpOptions = {
  /** A configured `x402Facilitator` with at least one scheme registered. */
  facilitator: x402Facilitator;
  /** Public addresses of the signer(s). Surfaced on `/health` for ops. */
  signerAddresses: readonly string[];
  /** Networks this facilitator accepts (CAIP-2). Surfaced on `/health`. */
  networks: readonly string[];
  /** Build identifier exposed on `/health`. Defaults to `'leash-facilitator/0.1'`. */
  build?: string;
};

type VerifyOrSettleBody = {
  x402Version?: number;
  paymentPayload?: PaymentPayload;
  paymentRequirements?: PaymentRequirements;
};

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate the wire shape both `verify` and `settle` use. Mirrors the
 * shape `HTTPFacilitatorClient` sends. Returns a tuple of either
 * `[null, error]` (caller should `c.json(error, 400)`) or
 * `[parsed, null]`.
 */
type ParsedFacilitatorBody = {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
};

function parseFacilitatorBody(
  body: unknown,
): { ok: true; value: ParsedFacilitatorBody } | { ok: false; error: string } {
  if (!isJsonObject(body)) return { ok: false, error: 'invalid_json' };
  const { paymentPayload, paymentRequirements } = body as VerifyOrSettleBody;
  if (!isJsonObject(paymentPayload)) return { ok: false, error: 'missing_payment_payload' };
  if (!isJsonObject(paymentRequirements))
    return { ok: false, error: 'missing_payment_requirements' };
  return {
    ok: true,
    value: {
      payload: paymentPayload as PaymentPayload,
      requirements: paymentRequirements as PaymentRequirements,
    },
  };
}

export function createFacilitatorHttpServer(opts: CreateFacilitatorHttpOptions): Hono {
  const { facilitator } = opts;
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      ok: true,
      build: opts.build ?? 'leash-facilitator/0.1',
      networks: opts.networks,
      signers: opts.signerAddresses,
    }),
  );

  app.get('/supported', (c) => c.json(facilitator.getSupported()));

  app.post('/verify', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = parseFacilitatorBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const result = await facilitator.verify(parsed.value.payload, parsed.value.requirements);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Match the FacilitatorResponseError shape used by HTTPFacilitatorClient
      // so well-behaved clients surface the same diagnostic regardless of
      // which facilitator they hit.
      return c.json({ error: 'verify_failed', message }, 422);
    }
  });

  app.post('/settle', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = parseFacilitatorBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const result = await facilitator.settle(parsed.value.payload, parsed.value.requirements);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: 'settle_failed', message }, 422);
    }
  });

  return app;
}

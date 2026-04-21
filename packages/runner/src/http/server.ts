import { createPauseResolver, readPauseFromEnv, type PauseState } from '@leash/core';
import {
  EndpointCreateInputSchema,
  EndpointIdSchema,
  EndpointV1Schema,
  ReceiptV1Schema,
  type EndpointV1,
} from '@leash/schemas';
import { Hono } from 'hono';
import type { ReceiptStore } from '../storage/memory.js';
import { appendLine, listLines } from '../storage/memory.js';
import {
  createEndpointStore,
  generateEndpointId,
  type EndpointStore,
} from '../storage/endpoints.js';

export type RunnerHttpOptions = {
  /**
   * Resolves the current pause state. Defaults to `createPauseResolver({})`,
   * which honors `LEASH_KILL=1` and falls back to `LEASH_ONCHAIN_PAUSED=1`
   * (a process-level mirror; production deployments wire a real Umi-backed
   * AppData reader through `createPauseResolver({ fetchOnchainPaused })`).
   */
  resolvePause?: () => Promise<PauseState>;
  /**
   * Endpoint store backing `/endpoints`. Defaults to an in-memory store
   * with no persistence. Pass a pre-built one (e.g. with `persistPath`) to
   * survive restarts.
   */
  endpoints?: EndpointStore;
};

function defaultResolver(): () => Promise<PauseState> {
  return createPauseResolver({
    fetchOnchainPaused: async () => process.env.LEASH_ONCHAIN_PAUSED === '1',
  });
}

export function createHttpServer(store: ReceiptStore, opts?: RunnerHttpOptions): Hono {
  const resolvePause = opts?.resolvePause ?? defaultResolver();
  const endpoints = opts?.endpoints ?? createEndpointStore();
  const app = new Hono();
  app.get('/health', async (c) => {
    const state = await resolvePause();
    return c.json({ ok: !state.paused, paused: state.paused, source: state.source });
  });
  app.get('/pause', async (c) => {
    const state = await resolvePause();
    return c.json({
      paused: state.paused,
      source: state.source,
      env_kill: readPauseFromEnv(),
    });
  });
  app.get('/a/:mint/receipts.jsonl', (c) => {
    const mint = c.req.param('mint');
    const lines = listLines(store, mint);
    return new Response(lines.join('\n') + (lines.length ? '\n' : ''), {
      headers: { 'content-type': 'application/x-ndjson' },
    });
  });
  /**
   * Append a receipt to the in-memory feed for `:mint`. The mint in the URL
   * MUST match `receipt.agent` (callers can't post receipts for other agents).
   * Returns the canonical receipt back so callers can confirm the
   * `receipt_hash` they finalized matches what the runner stored.
   */
  app.post('/a/:mint/receipts', async (c) => {
    const mint = c.req.param('mint');
    const body = (await c.req.json().catch(() => null)) as unknown;
    if (body == null) {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = ReceiptV1Schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_receipt', detail: parsed.error.message }, 422);
    }
    if (parsed.data.agent !== mint) {
      return c.json(
        { error: 'agent_mismatch', detail: `receipt.agent=${parsed.data.agent} != :mint=${mint}` },
        422,
      );
    }
    appendLine(store, mint, JSON.stringify(parsed.data));
    return c.json({ ok: true, receipt_hash: parsed.data.receipt_hash });
  });

  /**
   * List every payment-link endpoint registered with this runner.
   * Used by the seller payment-link builder UI to render the user's saved
   * links and by `/x/[id]` to resolve the active offer.
   */
  app.get('/endpoints', (c) => {
    const owner = c.req.query('owner_agent');
    const all = endpoints.list();
    return c.json({ endpoints: owner ? all.filter((e) => e.owner_agent === owner) : all });
  });

  /** Fetch a single endpoint by id. */
  app.get('/endpoints/:id', (c) => {
    const id = c.req.param('id');
    const ep = endpoints.get(id);
    if (!ep) return c.json({ error: 'not_found' }, 404);
    return c.json(ep);
  });

  /**
   * Create or update a payment-link endpoint. The runner generates an `id`
   * if one isn't supplied. Validation uses `EndpointCreateInputSchema` so
   * misshapen UI submissions return `422` instead of poisoning the store.
   */
  app.post('/endpoints', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    if (body == null) return c.json({ error: 'invalid_json' }, 400);
    const parsed = EndpointCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_endpoint', detail: parsed.error.message }, 422);
    }
    const now = new Date().toISOString();
    let id = parsed.data.id ?? generateEndpointId();
    while (endpoints.get(id)) id = generateEndpointId();
    const existing = endpoints.get(id);
    const endpoint: EndpointV1 = EndpointV1Schema.parse({
      ...parsed.data,
      v: '0.1',
      id,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    endpoints.upsert(endpoint);
    return c.json({ ok: true, endpoint });
  });

  /** Remove an endpoint. Returns `204` on success, `404` if it didn't exist. */
  app.delete('/endpoints/:id', (c) => {
    const id = c.req.param('id');
    const idCheck = EndpointIdSchema.safeParse(id);
    if (!idCheck.success) return c.json({ error: 'invalid_id' }, 400);
    const ok = endpoints.remove(id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return new Response(null, { status: 204 });
  });

  return app;
}

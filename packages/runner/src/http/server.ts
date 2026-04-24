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

export type RunnerForwardConfig = {
  /**
   * Base URL of the Leash API (e.g. `https://api.leash.market`). The
   * runner POSTs every accepted receipt to `${url}/v1/receipts/${agent}`.
   */
  apiUrl: string;
  /**
   * API key used to authenticate the forwarded POST. If missing or it
   * does not parse as `lsh_test_*` / `lsh_live_*`, the runner skips
   * forwarding (a misconfigured forwarder must never break local dev).
   */
  apiKey: string;
  /**
   * Optional `fetch` override. Default is the global fetch. Tests pass
   * a stub that records the calls so the runner doesn't accidentally
   * reach a real network.
   */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

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
  /**
   * If set, every accepted receipt is forwarded to the Leash API in the
   * background so explorer + dashboards see runner traffic without the
   * caller needing to know about both surfaces. Forward errors are
   * logged but swallowed: the local runner remains the source of truth
   * for the in-memory feed.
   */
  forward?: RunnerForwardConfig;
};

function defaultResolver(): () => Promise<PauseState> {
  return createPauseResolver({
    fetchOnchainPaused: async () => process.env.LEASH_ONCHAIN_PAUSED === '1',
  });
}

export function createHttpServer(store: ReceiptStore, opts?: RunnerHttpOptions): Hono {
  const resolvePause = opts?.resolvePause ?? defaultResolver();
  const endpoints = opts?.endpoints ?? createEndpointStore();
  const forward = opts?.forward ?? null;
  const forwardFetch = forward?.fetch ?? globalThis.fetch;
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
    // Best-effort forward to the Leash API so the explorer and per-key
    // metrics see runner traffic. We `void` the promise to keep the
    // runner's request latency bounded by the local append.
    if (forward) {
      void forwardReceipt(forward, forwardFetch, mint, parsed.data).catch((err: unknown) => {
        // eslint-disable-next-line no-console -- runner is a local dev sidecar; surface errors loudly.
        console.warn('[runner] receipt forward failed:', (err as Error).message);
      });
    }
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

/**
 * Forward an accepted receipt to `${apiUrl}/v1/receipts/{agent}` using the
 * `Authorization: Bearer <apiKey>` header. Errors throw upward to the
 * caller's `void` site so the runner request keeps returning 200.
 */
async function forwardReceipt(
  forward: RunnerForwardConfig,
  fetchImpl: NonNullable<RunnerForwardConfig['fetch']>,
  agent: string,
  receipt: unknown,
): Promise<void> {
  const url = `${forward.apiUrl.replace(/\/+$/, '')}/v1/receipts/${encodeURIComponent(agent)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${forward.apiKey}`,
    },
    body: JSON.stringify(receipt),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`POST /v1/receipts/${agent} -> ${res.status}: ${detail.slice(0, 200)}`);
  }
}

import { createPauseResolver, readPauseFromEnv, type PauseState } from '@leash/core';
import { ReceiptV1Schema } from '@leash/schemas';
import { Hono } from 'hono';
import type { ReceiptStore } from '../storage/memory.js';
import { appendLine, listLines } from '../storage/memory.js';

export type RunnerHttpOptions = {
  /**
   * Resolves the current pause state. Defaults to `createPauseResolver({})`,
   * which honors `LEASH_KILL=1` and falls back to `LEASH_ONCHAIN_PAUSED=1`
   * (a process-level mirror; production deployments wire a real Umi-backed
   * AppData reader through `createPauseResolver({ fetchOnchainPaused })`).
   */
  resolvePause?: () => Promise<PauseState>;
};

function defaultResolver(): () => Promise<PauseState> {
  return createPauseResolver({
    fetchOnchainPaused: async () => process.env.LEASH_ONCHAIN_PAUSED === '1',
  });
}

export function createHttpServer(store: ReceiptStore, opts?: RunnerHttpOptions): Hono {
  const resolvePause = opts?.resolvePause ?? defaultResolver();
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
  return app;
}

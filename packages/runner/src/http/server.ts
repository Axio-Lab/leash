import { createPauseResolver, readPauseFromEnv, type PauseState } from '@leash/core';
import { Hono } from 'hono';
import type { ReceiptStore } from '../storage/memory.js';
import { listLines } from '../storage/memory.js';

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
  return app;
}

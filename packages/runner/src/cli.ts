import { serve } from '@hono/node-server';
import { createMemoryStore } from './storage/memory.js';
import { createEndpointStore } from './storage/endpoints.js';
import { createHttpServer, type RunnerForwardConfig } from './http/server.js';

const port = Number(process.env.PORT ?? 8787);
const store = createMemoryStore();
const endpoints = createEndpointStore({
  // Persist payment-link endpoints next to the runner process so that
  // restarts don't blow them away. Override with LEASH_RUNNER_DATA=/path
  // (or set to an empty string to disable).
  persistPath: process.env.LEASH_RUNNER_DATA ?? './.leash/endpoints.jsonl',
});

/**
 * Optional env-driven forwarder: when both `LEASH_API_URL` and
 * `LEASH_API_KEY` are set, every accepted receipt is mirrored to the
 * Leash API in the background. This is what lets a local runner
 * automatically populate the explorer feed without the agent author
 * needing to plumb the API client manually.
 */
let forward: RunnerForwardConfig | undefined;
if (process.env.LEASH_API_URL && process.env.LEASH_API_KEY) {
  forward = {
    apiUrl: process.env.LEASH_API_URL,
    apiKey: process.env.LEASH_API_KEY,
  };
}

const app = createHttpServer(store, { endpoints, ...(forward ? { forward } : {}) });

serve({ fetch: app.fetch, port });
console.log(`leash-runner listening on :${port}${forward ? ' (forwarding receipts to API)' : ''}`);

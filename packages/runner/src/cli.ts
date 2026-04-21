import { serve } from '@hono/node-server';
import { createMemoryStore } from './storage/memory.js';
import { createEndpointStore } from './storage/endpoints.js';
import { createHttpServer } from './http/server.js';

const port = Number(process.env.PORT ?? 8787);
const store = createMemoryStore();
const endpoints = createEndpointStore({
  // Persist payment-link endpoints next to the runner process so that
  // restarts don't blow them away. Override with LEASH_RUNNER_DATA=/path
  // (or set to an empty string to disable).
  persistPath: process.env.LEASH_RUNNER_DATA ?? './.leash/endpoints.jsonl',
});
const app = createHttpServer(store, { endpoints });

serve({ fetch: app.fetch, port });
console.log(`leash-runner listening on :${port}`);

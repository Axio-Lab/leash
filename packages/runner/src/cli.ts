import { serve } from '@hono/node-server';
import { createMemoryStore } from './storage/memory.js';
import { createHttpServer } from './http/server.js';

const port = Number(process.env.PORT ?? 8787);
const store = createMemoryStore();
const app = createHttpServer(store);

serve({ fetch: app.fetch, port });
console.log(`leash-runner listening on :${port}`);

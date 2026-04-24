/**
 * Local-dev entrypoint for `@leash/api`. Reads env from the working
 * directory's `.env` (via `--env-file=.env` or `dotenv-cli`), runs DB
 * migrations, and serves on `LEASH_API_HOST:LEASH_API_PORT`.
 *
 * In production use the published `leash-api` binary (see `cli.ts`).
 */

import { serve } from '@hono/node-server';

import { boot } from './bootstrap.js';
import { createConfig } from './config.js';
import { createLeashApiApp } from './server.js';
import { getCache } from './storage/redis.js';
import { getDb } from './storage/turso.js';
import { startWebhookWorker } from './webhooks/worker.js';

const config = createConfig();
const db = getDb(config);
const cache = getCache(config);

await boot({ db, config });

const app = createLeashApiApp({ config, db, cache });
const webhookHandle = startWebhookWorker(db);

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[leash-api] dev server on http://${config.host}:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`[leash-api] OpenAPI:  http://${config.host}:${info.port}/openapi.json`);
  // eslint-disable-next-line no-console
  console.log(`[leash-api] webhook delivery worker started (every 2s)`);
});

const shutdown = () => {
  webhookHandle.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

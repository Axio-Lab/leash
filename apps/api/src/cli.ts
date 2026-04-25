#!/usr/bin/env node
/**
 * Production binary `leash-api`. Same wiring as `dev.ts` but built and
 * published as `dist/cli.js`.
 */

import { serve } from '@hono/node-server';

import { boot } from './bootstrap.js';
import { createConfig } from './config.js';
import { createLeashApiApp } from './server.js';
import { setEventPublisherCache } from './storage/events-pubsub.js';
import { getCache, pingCache } from './storage/redis.js';
import { getDb } from './storage/turso.js';

async function main(): Promise<void> {
  const config = createConfig();
  const db = getDb(config);
  const cache = getCache(config);
  await boot({ db, config });
  await pingCache(config, cache);
  setEventPublisherCache(cache);
  const app = createLeashApiApp({ config, db, cache });
  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`[leash-api] up on http://${config.host}:${info.port}`);
  });
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[leash-api] startup failed:', err);
  process.exit(1);
});

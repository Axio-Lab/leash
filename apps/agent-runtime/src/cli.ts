#!/usr/bin/env node
import { getDb } from './db.js';
import { getEnv } from './env.js';
import { runLoop } from './loop.js';
import { createPublisher } from './publisher.js';

async function main(): Promise<void> {
  const env = getEnv();
  const db = getDb();
  const publisher = createPublisher(env.redisUrl);
  // eslint-disable-next-line no-console
  console.log(
    `[leash-agent-runtime] booted — polling every ${env.pollMs}ms · redis=${env.redisUrl ? 'yes' : 'no'}`,
  );
  let stopping = false;
  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    // eslint-disable-next-line no-console
    console.log(`[leash-agent-runtime] received ${sig}, draining…`);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  await runLoop({
    db,
    publisher,
    encryptionKey: env.encryptionKey,
    pollMs: env.pollMs,
    shouldStop: () => stopping,
  });
  await publisher.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[leash-agent-runtime] fatal:', err);
  process.exit(1);
});

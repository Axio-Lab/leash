/**
 * Shared test harness. Spins up an in-memory libsql DB, the Redis
 * fallback (`MemoryCacheClient`), and the `OpenAPIHono` app — then
 * registers a fresh devnet API key for tests to call with.
 */

import { createClient } from '@libsql/client';

import { createLeashApiApp } from '../src/server.js';
import { boot } from '../src/bootstrap.js';
import { createApiKey } from '../src/storage/api-keys.js';
import { _resetCacheForTests, getCache } from '../src/storage/redis.js';
import { _resetDbForTests, type DbClient } from '../src/storage/turso.js';
import type { LeashApiConfig } from '../src/config.js';

export type TestRig = {
  app: ReturnType<typeof createLeashApiApp>;
  db: DbClient;
  config: LeashApiConfig;
  apiKey: string;
};

export async function createTestRig(overrides: Partial<LeashApiConfig> = {}): Promise<TestRig> {
  _resetDbForTests();
  _resetCacheForTests();
  // Each rig gets its own anonymous in-memory DB so state never bleeds
  // across tests in the same process. The previous shared-cache URL
  // (`file::memory:?cache=shared`) was a single global DB that every
  // rig wrote into, which made counting assertions impossible.
  const db = createClient({ url: ':memory:' });
  const config: LeashApiConfig = {
    host: '127.0.0.1',
    port: 0,
    rpc: {
      'solana-devnet': 'https://api.devnet.solana.com',
      'solana-mainnet': 'https://api.mainnet-beta.solana.com',
    },
    db: { url: ':memory:' },
    redisUrl: null,
    rateLimitRpm: 5,
    ...overrides,
  };
  const cache = getCache(config);
  await boot({ db, config });
  const { plaintext } = await createApiKey(db, {
    label: 'test',
    network: 'solana-devnet',
  });
  const app = createLeashApiApp({ config, db, cache });
  return { app, db, config, apiKey: plaintext };
}

export async function authedFetch(
  rig: TestRig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${rig.apiKey}`);
  return rig.app.fetch(new Request(`http://test.local${path}`, { ...init, headers }));
}

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
  const db = createClient({ url: 'file::memory:?cache=shared' });
  const config: LeashApiConfig = {
    host: '127.0.0.1',
    port: 0,
    rpc: {
      'solana-devnet': 'https://api.devnet.solana.com',
      'solana-mainnet': 'https://api.mainnet-beta.solana.com',
    },
    db: { url: 'file::memory:?cache=shared' },
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

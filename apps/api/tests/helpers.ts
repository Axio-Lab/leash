/**
 * Shared test harness. Spins up an in-memory libsql DB, the Redis
 * fallback (`MemoryCacheClient`), and the `OpenAPIHono` app — then
 * registers a fresh devnet API key for tests to call with.
 */

import { createClient } from '@libsql/client';

import { createLeashApiApp, type CreateLeashApiArgs } from '../src/server.js';
import { boot } from '../src/bootstrap.js';
import { createApiKey } from '../src/storage/api-keys.js';

/** Devnet pubkey used as `owner_wallet` when tests insert keys via `createApiKey` directly. */
export const TEST_API_KEY_OWNER_WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
import { setEventPublisherCache } from '../src/storage/events-pubsub.js';
import { _resetCacheForTests, getCache } from '../src/storage/redis.js';
import { _resetDbForTests, type DbClient } from '../src/storage/turso.js';
import type { LeashApiConfig } from '../src/config.js';

// Tests configure the API to point its hosted paywall at the unreachable
// host `facilitator.test.invalid` so settle-side asserts never depend on
// a network round-trip. The seller-kit middleware (`@x402/hono`)
// initializes by fetching `${facilitator}/supported` on the first
// request and `throw`s on DNS failure, which Hono catches and dumps to
// stderr — polluting CI output even when the test itself passes
// (paywall tests only assert `status !== 200` on unpaid requests, which
// holds either way).
//
// We shim global `fetch` ONCE per process to short-circuit any URL on
// the test host with a valid empty `SupportedResponse`. The middleware
// then initializes cleanly with zero registered schemes, every unpaid
// `/x/{id}` request returns a non-200 (still satisfying the assertion),
// and stderr stays quiet. All other URLs fall through to the real fetch
// untouched.
installFacilitatorTestFetchShimOnce();
function installFacilitatorTestFetchShimOnce(): void {
  const flag = '__leashFacilitatorTestFetchShim';
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[flag]) return;
  g[flag] = true;

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.includes('facilitator.test.invalid')) {
      // Mimic an x402 facilitator's `/supported` endpoint with both
      // v1 (legacy network slug) and v2 (CAIP-2) entries for SVM so
      // the seller-kit middleware passes its
      //   "no supported payment kinds loaded from any facilitator"
      // initialization gate. Unpaid `/x/{id}` requests then get a
      // real 402 (or 5xx if settle/verify are exercised), which is
      // still what the paywall tests assert ("status !== 200").
      return new Response(
        JSON.stringify({
          kinds: [
            { x402Version: 1, scheme: 'exact', network: 'solana-devnet' },
            { x402Version: 1, scheme: 'exact', network: 'solana-mainnet' },
            {
              x402Version: 2,
              scheme: 'exact',
              network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
            },
            {
              x402Version: 2,
              scheme: 'exact',
              network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
            },
          ],
          extensions: [],
          signers: { svm: ['11111111111111111111111111111111'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input as Parameters<typeof realFetch>[0], init);
  }) as typeof globalThis.fetch;
}

export type TestRig = {
  app: ReturnType<typeof createLeashApiApp>;
  db: DbClient;
  config: LeashApiConfig;
  apiKey: string;
};

export type CreateTestRigOverrides = Partial<LeashApiConfig> & {
  externalDispatcherBffFetch?: CreateLeashApiArgs['externalDispatcherBffFetch'];
  externalDispatcherTelegramClientFactory?: CreateLeashApiArgs['externalDispatcherTelegramClientFactory'];
  externalWhatsAppManager?: CreateLeashApiArgs['externalWhatsAppManager'];
};

export async function createTestRig(overrides: CreateTestRigOverrides = {}): Promise<TestRig> {
  _resetDbForTests();
  _resetCacheForTests();
  // Each rig gets its own anonymous in-memory DB so state never bleeds
  // across tests in the same process. The previous shared-cache URL
  // (`file::memory:?cache=shared`) was a single global DB that every
  // rig wrote into, which made counting assertions impossible.
  const db = createClient({ url: ':memory:' });
  const {
    externalDispatcherBffFetch,
    externalDispatcherTelegramClientFactory,
    externalWhatsAppManager,
    ...configOverrides
  } = overrides;
  const merged: Partial<LeashApiConfig> & Pick<LeashApiConfig, 'host' | 'port' | 'rpc' | 'db'> = {
    host: '127.0.0.1',
    port: 0,
    rpc: {
      'solana-devnet': 'https://api.devnet.solana.com',
      'solana-mainnet': 'https://api.mainnet-beta.solana.com',
    },
    db: { url: ':memory:' },
    redisUrl: null,
    rateLimitRpm: 5,
    docsEnabled: false,
    facilitatorUrlDevnet: 'https://facilitator.test.invalid',
    publicOrigin: 'http://test.local',
    explorerPublicOrigin: 'https://explorer.test.invalid',
    ...configOverrides,
  };
  const config: LeashApiConfig = {
    ...(merged as LeashApiConfig),
    agentsPublicOrigin:
      merged.agentsPublicOrigin ??
      (merged.agentsBffUrl
        ? new URL(merged.agentsBffUrl.replace(/\/+$/, '')).origin
        : (merged.publicOrigin ?? 'http://test.local')),
  };
  const cache = getCache(config);
  // Tests exercise the same fanout path production uses, so pub/sub
  // delivery is wired up automatically. Without this, `publishLiveEvent`
  // in `events.ts` is a no-op and the SSE-bridge tests can't verify
  // delivery from inside vitest.
  setEventPublisherCache(cache);
  await boot({ db, config });
  const { plaintext } = await createApiKey(db, {
    label: 'test',
    network: 'solana-devnet',
    ownerWallet: TEST_API_KEY_OWNER_WALLET,
  });
  const app = createLeashApiApp({
    config,
    db,
    cache,
    ...(externalDispatcherBffFetch ? { externalDispatcherBffFetch } : {}),
    ...(externalDispatcherTelegramClientFactory ? { externalDispatcherTelegramClientFactory } : {}),
    ...(externalWhatsAppManager ? { externalWhatsAppManager } : {}),
  });
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

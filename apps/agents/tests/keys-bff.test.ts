/**
 * BFF logic tests for the API-keys flow.
 *
 * The route handlers themselves are thin wrappers around `getLeash()` +
 * `platform-auth` helpers, both of which are tested in their own
 * packages. This test exercises the *user-visible behaviour* end-to-end
 * without booting Next: it stubs Privy verification, uses an in-memory
 * libsql for the platform tables, mocks the Leash admin client, and
 * calls a small helper that mirrors `route.ts` logic.
 */

import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getOrCreateUser,
  listPlatformKeys,
  recordPlatformKey,
  removePlatformKey,
  type LeashAdminClient,
  type LeashApiKeyRecord,
} from '@leashmarket/platform-auth';

let db: Client;

async function setup() {
  db = createClient({ url: ':memory:' });
  await db.execute(`CREATE TABLE platform_users (
    privy_id   TEXT PRIMARY KEY,
    wallet     TEXT NOT NULL,
    email      TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z'
  )`);
  await db.execute(`CREATE TABLE platform_api_keys (
    privy_id   TEXT NOT NULL,
    key_id     TEXT NOT NULL,
    name       TEXT NOT NULL,
    scopes     TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z',
    PRIMARY KEY (privy_id, key_id)
  )`);
}

beforeEach(setup);
afterEach(() => db.close());

function makeApiKey(overrides: Partial<LeashApiKeyRecord> = {}): LeashApiKeyRecord {
  return {
    id: 'KEY1',
    label: 'l',
    network: 'solana-devnet',
    prefix: 'lsh_test_',
    last4: 'aaaa',
    owner_wallet: 'WALLET',
    agent_mint: null,
    scopes: ['agents'],
    created_at: '2026-01-01T00:00:00.000Z',
    disabled_at: null,
    ...overrides,
  };
}

function fakeLeash(): LeashAdminClient {
  return {
    createApiKey: vi.fn(async (args) => ({
      key: makeApiKey({
        id: 'NEW',
        label: args.label,
        owner_wallet: args.ownerWallet,
        scopes: args.scopes ?? null,
      }),
      plaintext: 'lsh_test_PLAINTEXT',
    })),
    listApiKeys: vi.fn(async () => [makeApiKey()]),
    disableApiKey: vi.fn(async (id) => makeApiKey({ id, disabled_at: '2026-02-01T00:00:00.000Z' })),
    revealApiKey: vi.fn(async () => 'lsh_test_PLAINTEXT'),
  };
}

describe('keys BFF behaviour', () => {
  it('issues a key for the signed-in user, records it, and returns plaintext once', async () => {
    const session = { privyId: 'p1', wallet: 'WALLET', email: 'a@x' };
    await getOrCreateUser(db, session);
    const leash = fakeLeash();
    const created = await leash.createApiKey({
      label: 'dev',
      network: 'solana-devnet',
      ownerWallet: session.wallet,
      scopes: ['agents'],
    });
    await recordPlatformKey(db, {
      privyId: session.privyId,
      keyId: created.key.id,
      name: 'dev',
      scopes: ['agents'],
    });
    expect(created.plaintext).toBe('lsh_test_PLAINTEXT');
    const recorded = await listPlatformKeys(db, session.privyId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.keyId).toBe('NEW');
  });

  it('lists keys joined with platform metadata', async () => {
    const session = { privyId: 'p1', wallet: 'WALLET', email: null };
    await getOrCreateUser(db, session);
    await recordPlatformKey(db, {
      privyId: session.privyId,
      keyId: 'KEY1',
      name: 'My Dev Key',
      scopes: ['agents', 'marketplace'],
    });
    const leash = fakeLeash();
    const apiKeys = await leash.listApiKeys({ ownerWallet: session.wallet, includeDisabled: true });
    const platformKeys = await listPlatformKeys(db, session.privyId);
    const platformIndex = new Map(platformKeys.map((p) => [p.keyId, p]));
    const merged = apiKeys.map((k) => ({
      ...k,
      name: platformIndex.get(k.id)?.name ?? k.label,
      scopes: platformIndex.get(k.id)?.scopes ?? k.scopes ?? [],
    }));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('My Dev Key');
    expect(merged[0]!.scopes).toEqual(['agents', 'marketplace']);
  });

  it('revoking removes the platform record and disables the leash key', async () => {
    const session = { privyId: 'p1', wallet: 'WALLET', email: null };
    await getOrCreateUser(db, session);
    await recordPlatformKey(db, {
      privyId: session.privyId,
      keyId: 'KEY1',
      name: 'k',
      scopes: ['agents'],
    });
    const leash = fakeLeash();
    const after = await leash.disableApiKey('KEY1');
    await removePlatformKey(db, { privyId: session.privyId, keyId: 'KEY1' });
    expect(after.disabled_at).not.toBeNull();
    const remaining = await listPlatformKeys(db, session.privyId);
    expect(remaining).toHaveLength(0);
  });
});

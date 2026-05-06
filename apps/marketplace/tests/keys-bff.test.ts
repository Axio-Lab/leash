/**
 * Mirror of the agents app `keys-bff.test.ts`, but the default scope
 * for marketplace BFF-issued keys is `["marketplace"]`. Otherwise the
 * shape is identical: stub Privy, in-memory libsql, mocked Leash admin
 * client, exercise create / list / revoke.
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
    scopes: ['marketplace'],
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

describe('marketplace keys BFF', () => {
  it('issues a key with marketplace scope by default', async () => {
    const session = { privyId: 'p1', wallet: 'WALLET', email: null };
    await getOrCreateUser(db, session);
    const leash = fakeLeash();
    const created = await leash.createApiKey({
      label: 'ci',
      network: 'solana-devnet',
      ownerWallet: session.wallet,
      scopes: ['marketplace'],
    });
    await recordPlatformKey(db, {
      privyId: session.privyId,
      keyId: created.key.id,
      name: 'ci',
      scopes: ['marketplace'],
    });
    expect(created.plaintext).toBe('lsh_test_PLAINTEXT');
    expect(created.key.scopes).toEqual(['marketplace']);
    const recorded = await listPlatformKeys(db, session.privyId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.scopes).toContain('marketplace');
  });

  it('revoking removes the platform record', async () => {
    const session = { privyId: 'p1', wallet: 'WALLET', email: null };
    await getOrCreateUser(db, session);
    await recordPlatformKey(db, {
      privyId: session.privyId,
      keyId: 'KEY1',
      name: 'k',
      scopes: ['marketplace'],
    });
    const leash = fakeLeash();
    const after = await leash.disableApiKey('KEY1');
    await removePlatformKey(db, { privyId: session.privyId, keyId: 'KEY1' });
    expect(after.disabled_at).not.toBeNull();
    expect(await listPlatformKeys(db, session.privyId)).toHaveLength(0);
  });
});

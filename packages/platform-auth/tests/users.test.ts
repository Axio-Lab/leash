import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getOrCreateUser,
  getUser,
  listPlatformKeys,
  recordPlatformKey,
  removePlatformKey,
} from '../src/index.js';

let db: ReturnType<typeof createClient>;

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

describe('platform users + keys', () => {
  it('creates a user, returns it idempotently, and updates wallet/email', async () => {
    const u1 = await getOrCreateUser(db, {
      privyId: 'did:privy:1',
      wallet: 'WALLET_A',
      email: 'a@x',
    });
    expect(u1.privyId).toBe('did:privy:1');
    expect(u1.wallet).toBe('WALLET_A');
    const u2 = await getOrCreateUser(db, {
      privyId: 'did:privy:1',
      wallet: 'WALLET_A',
      email: 'a@x',
    });
    expect(u2.createdAt).toBe(u1.createdAt);
    const u3 = await getOrCreateUser(db, {
      privyId: 'did:privy:1',
      wallet: 'WALLET_B',
      email: null,
    });
    expect(u3.wallet).toBe('WALLET_B');
    expect(u3.email).toBeNull();
  });

  it('returns null for unknown privy id', async () => {
    expect(await getUser(db, 'nope')).toBeNull();
  });

  it('records, lists, and removes platform api keys', async () => {
    await getOrCreateUser(db, { privyId: 'p1', wallet: 'W', email: null });
    await recordPlatformKey(db, {
      privyId: 'p1',
      keyId: 'k1',
      name: 'dev',
      scopes: ['agents'],
    });
    await recordPlatformKey(db, {
      privyId: 'p1',
      keyId: 'k2',
      name: 'prod',
      scopes: ['agents', 'marketplace'],
    });
    const all = await listPlatformKeys(db, 'p1');
    expect(all).toHaveLength(2);
    expect(all.map((k) => k.keyId).sort()).toEqual(['k1', 'k2']);
    expect(all.find((k) => k.keyId === 'k2')!.scopes).toEqual(['agents', 'marketplace']);
    await removePlatformKey(db, { privyId: 'p1', keyId: 'k1' });
    const after = await listPlatformKeys(db, 'p1');
    expect(after).toHaveLength(1);
    expect(after[0]!.keyId).toBe('k2');
  });
});

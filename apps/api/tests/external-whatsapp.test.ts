/**
 * Tests for the WhatsApp surface of the external chat bridge:
 *
 *   - `POST /v1/external/whatsapp/start/{id}` — kicks off a Baileys
 *     session via the injected manager. Returns 503 when the manager
 *     isn't wired (multi-replica safety) and 409 for the wrong channel.
 *   - `GET  /v1/external/whatsapp/qr/{id}`    — polling endpoint for
 *     the Add WhatsApp modal. Echoes the most recent QR persisted by
 *     the manager (or the one we seed directly into the DB here).
 *   - Storage roundtrip: `saveWhatsAppCreds`/`saveWhatsAppKeys` survive
 *     `BufferJSON.replacer/reviver` so the encrypted blobs decode back
 *     into byte-identical state.
 *   - Revoke teardown: deleting a WhatsApp connection clears the
 *     `external_whatsapp_state` row AND calls `manager.stop({logout})`.
 *
 * We never instantiate a real Baileys socket here — `WhatsAppManager`
 * is purely a structural type, so a hand-rolled stub satisfies it and
 * keeps the test deterministic / network-free.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { BufferJSON, initAuthCreds } from 'baileys';
import { decryptSecret } from '@leash/platform-auth/encryption';

import {
  ensureWhatsAppStateRow,
  getWhatsAppState,
  saveWhatsAppCreds,
  saveWhatsAppKeys,
  saveWhatsAppQr,
  loadWhatsAppCreds,
  loadWhatsAppKeys,
} from '../src/storage/external-whatsapp.js';
import type { WhatsAppManager } from '../src/external/whatsapp-manager.js';

import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'a'.repeat(64);
const PRIVY_ID = 'did:privy:wa-tester';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
});

function authHeaders() {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ADMIN_SECRET}`,
  };
}

function makeManagerStub(overrides: Partial<WhatsAppManager> = {}): WhatsAppManager {
  return {
    start: vi.fn(async () => ({ status: 'pairing' as const })),
    stop: vi.fn(async () => {}),
    getStatus: () => 'idle',
    events: { emit: () => false } as unknown as WhatsAppManager['events'],
    ...overrides,
  };
}

async function createWhatsAppConnection(rig: Awaited<ReturnType<typeof createTestRig>>) {
  const res = await rig.app.fetch(
    new Request('http://test.local/v1/external/connections', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        owner_privy_id: PRIVY_ID,
        channel: 'whatsapp',
        display_name: 'My WhatsApp',
      }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    connection: { id: string; channel: 'whatsapp'; status: string };
    deep_link: string | null;
    webhook_url: string | null;
  };
}

describe('external whatsapp — routes', () => {
  it('returns 503 when no WhatsApp manager is wired (multi-replica safety)', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const created = await createWhatsAppConnection(rig);
    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/external/whatsapp/start/${created.connection.id}`, {
        method: 'POST',
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe('unavailable');
  });

  it('returns 409 when the start route is called for a Telegram connection', async () => {
    const manager = makeManagerStub();
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      encryptionKey: ENC_KEY,
      externalWhatsAppManager: manager,
    });
    const tgRes = await rig.app.fetch(
      new Request('http://test.local/v1/external/connections', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          owner_privy_id: PRIVY_ID,
          channel: 'telegram',
          display_name: 'Wrong channel',
          bot_token: '999:'.padEnd(48, 'x'),
          bot_username: 'wrong_channel_bot',
        }),
      }),
    );
    const tg = (await tgRes.json()) as { connection: { id: string } };

    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/external/whatsapp/start/${tg.connection.id}`, {
        method: 'POST',
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(409);
    expect(manager.start).not.toHaveBeenCalled();
  });

  it('starts a session via the manager and returns the manager status', async () => {
    const manager = makeManagerStub({
      start: vi.fn(async () => ({ status: 'pairing' as const })),
    });
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      encryptionKey: ENC_KEY,
      externalWhatsAppManager: manager,
    });
    const created = await createWhatsAppConnection(rig);
    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/external/whatsapp/start/${created.connection.id}`, {
        method: 'POST',
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('pairing');
    expect(manager.start).toHaveBeenCalledWith(created.connection.id);
  });

  it('GET /qr/{id} reads the most recent persisted QR for the polling UI', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const created = await createWhatsAppConnection(rig);
    await ensureWhatsAppStateRow(rig.db, created.connection.id);
    await saveWhatsAppQr(rig.db, { connectionId: created.connection.id, qr: 'fake-qr-string' });

    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/external/whatsapp/qr/${created.connection.id}`, {
        method: 'GET',
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { qr: string | null; status: string };
    expect(body.qr).toBe('fake-qr-string');
    expect(body.status).toBe('pending');
  });

  it('DELETE /connections/{id} stops the manager and wipes the state row', async () => {
    const manager = makeManagerStub();
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      encryptionKey: ENC_KEY,
      externalWhatsAppManager: manager,
    });
    const created = await createWhatsAppConnection(rig);
    // Drop something into the state row so we can confirm it's deleted.
    await saveWhatsAppQr(rig.db, { connectionId: created.connection.id, qr: 'pending-pair' });

    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/external/connections/${created.connection.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    expect(manager.stop).toHaveBeenCalledWith(created.connection.id, { logout: true });

    const after = await getWhatsAppState(rig.db, created.connection.id);
    expect(after).toBeNull();
  });
});

describe('external whatsapp — encrypted state roundtrip', () => {
  it('survives BufferJSON.replacer/reviver and the AES envelope', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const created = await createWhatsAppConnection(rig);
    const id = created.connection.id;
    await ensureWhatsAppStateRow(rig.db, id);

    const creds = initAuthCreds();
    const credsJson = JSON.stringify(creds, BufferJSON.replacer);
    await saveWhatsAppCreds(rig.db, {
      connectionId: id,
      credsJson,
      encryptionKey: ENC_KEY,
    });

    const keysMap = {
      'pre-key-1': { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) },
      'session-x@y': new Uint8Array([9, 8, 7, 6]),
    };
    const keysJson = JSON.stringify(keysMap, BufferJSON.replacer);
    await saveWhatsAppKeys(rig.db, {
      connectionId: id,
      keysJson,
      encryptionKey: ENC_KEY,
    });

    const row = await getWhatsAppState(rig.db, id);
    expect(row).not.toBeNull();
    expect(row!.encryptedCreds).not.toContain('noiseKey');

    // Roundtrip through the load helpers (which decrypt) + reviver.
    const decryptedCreds = JSON.parse(loadWhatsAppCreds(row!, ENC_KEY)!, BufferJSON.reviver);
    expect(decryptedCreds.registrationId).toBe(creds.registrationId);
    expect(decryptedCreds.advSecretKey).toBe(creds.advSecretKey);

    const decryptedKeys = JSON.parse(loadWhatsAppKeys(row!, ENC_KEY)!, BufferJSON.reviver);
    expect(Buffer.from(decryptedKeys['pre-key-1'].public).equals(Buffer.from([1, 2, 3]))).toBe(
      true,
    );
    // The Uint8Array path comes back as a Buffer (BufferJSON normalises
    // both into the `Buffer` constructor on revive) — check the bytes.
    expect(Array.from(decryptedKeys['session-x@y'])).toEqual([9, 8, 7, 6]);

    // Sanity check: the raw column was actually encrypted (not just JSON
    // stringified), so a leak of the DB doesn't expose Signal keys.
    const direct = await rig.db.execute({
      sql: 'SELECT encrypted_keys FROM external_whatsapp_state WHERE connection_id = ?',
      args: [id],
    });
    const blob = String((direct.rows[0] as Record<string, unknown>).encrypted_keys);
    expect(() => decryptSecret(blob, ENC_KEY)).not.toThrow();
    expect(blob).not.toContain('pre-key-1');
  });
});

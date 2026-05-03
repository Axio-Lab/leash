/**
 * Tests for the v13 external chat bridge surface (`/v1/external/*`).
 *
 * Phase 1 covers:
 *   - Admin-gated CRUD for connections (Telegram-flavored).
 *   - Encrypted-at-rest bot tokens (round-trip through `decryptSecret`).
 *   - Verification token lifecycle (refresh → bind via `/start`).
 *   - Strict self-only filter on the webhook (drop unknown senders).
 *   - Approval token lifecycle (mint → consume → idempotent re-consume).
 *   - Public approval read endpoint (no admin secret needed).
 *
 * Phase 3 will add dispatcher tests once @leash/agent-runtime is wired
 * up; until then the webhook returns `queued: true` for authorised
 * messages and `dropped: ...` otherwise.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret } from '@leash/platform-auth/encryption';

import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'a'.repeat(64);
const PRIVY_ID = 'did:privy:demo';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';
const BOT_TOKEN = '123456789:ABCdef-ghi_jklmnopqrstuvwxyz12345678';
const BOT_USERNAME = 'leash_test_bot';
const TELEGRAM_FROM_ID = '999111222';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
});

function authHeaders() {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ADMIN_SECRET}`,
  };
}

async function createConnection(rig: Awaited<ReturnType<typeof createTestRig>>) {
  const res = await rig.app.fetch(
    new Request('http://test.local/v1/external/connections', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        owner_privy_id: PRIVY_ID,
        channel: 'telegram',
        display_name: 'My Telegram',
        bot_token: BOT_TOKEN,
        bot_username: BOT_USERNAME,
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    connection: {
      id: string;
      status: string;
      verification_token: string;
      bot_username: string;
      routing_id: string;
    };
    deep_link: string | null;
    webhook_url: string | null;
  };
  return body;
}

describe('external connections — CRUD', () => {
  it('returns 503 when admin secret is not configured', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/external/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(503);
  });

  it('rejects without admin secret', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/external/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects telegram create without bot_token / bot_username', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/external/connections', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          owner_privy_id: PRIVY_ID,
          channel: 'telegram',
          display_name: 'no token',
        }),
      }),
    );
    expect([400, 422]).toContain(res.status);
  });

  it('creates a telegram connection, encrypts the bot token, and emits deep link + webhook url', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const body = await createConnection(rig);

    expect(body.connection.status).toBe('pending');
    expect(body.connection.verification_token).toBeTruthy();
    expect(body.connection.routing_id).toMatch(/^[0-9a-f]{64}$/);
    expect(body.deep_link).toBe(
      `https://t.me/${BOT_USERNAME}?start=${body.connection.verification_token}`,
    );
    expect(body.webhook_url).toContain(
      `/v1/external/telegram/webhook/${body.connection.routing_id}`,
    );

    const dbRow = await rig.db.execute({
      sql: 'SELECT encrypted_credential FROM external_connections WHERE id = ?',
      args: [body.connection.id],
    });
    const encrypted = String(dbRow.rows[0]!.encrypted_credential);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptSecret(encrypted, ENC_KEY)).toBe(BOT_TOKEN);

    const list = await rig.app.fetch(
      new Request(
        `http://test.local/v1/external/connections?owner_privy_id=${encodeURIComponent(PRIVY_ID)}`,
        { headers: authHeaders() },
      ),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { items: Array<{ id: string }> };
    expect(listBody.items.map((i) => i.id)).toEqual([body.connection.id]);
  });

  it('refreshes the verification_token and clears bound_chat_id', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const body = await createConnection(rig);
    const refresh = await rig.app.fetch(
      new Request(`http://test.local/v1/external/connections/${body.connection.id}/refresh`, {
        method: 'POST',
        headers: authHeaders(),
      }),
    );
    expect(refresh.status).toBe(200);
    const refreshed = (await refresh.json()) as {
      connection: { verification_token: string; bound_chat_id: string | null };
      deep_link: string | null;
    };
    expect(refreshed.connection.verification_token).not.toBe(body.connection.verification_token);
    expect(refreshed.connection.bound_chat_id).toBeNull();
    expect(refreshed.deep_link).toContain(refreshed.connection.verification_token);
  });

  it('PATCH switches to delegated signing with caps and encrypts the secret key', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const body = await createConnection(rig);
    const SECRET_KEY_B58 = '5'.repeat(64);
    const DELEGATED_PUBKEY = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';

    const patch = await rig.app.fetch(
      new Request(`http://test.local/v1/external/connections/${body.connection.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          signing_mode: 'delegated',
          cap_per_tx: '5.00',
          cap_per_day: '50.00',
          delegated_secret_key_b58: SECRET_KEY_B58,
          delegated_pubkey: DELEGATED_PUBKEY,
        }),
      }),
    );
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as {
      signing_mode: string;
      cap_per_tx: string;
      cap_per_day: string;
      delegated_pubkey: string;
    };
    expect(patched.signing_mode).toBe('delegated');
    expect(patched.cap_per_tx).toBe('5.00');
    expect(patched.cap_per_day).toBe('50.00');
    expect(patched.delegated_pubkey).toBe(DELEGATED_PUBKEY);

    const row = await rig.db.execute({
      sql: 'SELECT encrypted_delegated_key FROM external_connections WHERE id = ?',
      args: [body.connection.id],
    });
    expect(decryptSecret(String(row.rows[0]!.encrypted_delegated_key), ENC_KEY)).toBe(
      SECRET_KEY_B58,
    );

    // Switching back clears caps + encrypted key.
    const back = await rig.app.fetch(
      new Request(`http://test.local/v1/external/connections/${body.connection.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ signing_mode: 'deep_link' }),
      }),
    );
    expect(back.status).toBe(200);
    const reverted = (await back.json()) as {
      signing_mode: string;
      cap_per_tx: string | null;
      delegated_pubkey: string | null;
    };
    expect(reverted.signing_mode).toBe('deep_link');
    expect(reverted.cap_per_tx).toBeNull();
    expect(reverted.delegated_pubkey).toBeNull();
  });

  it('PATCH delegated without caps fails 422', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const body = await createConnection(rig);
    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/external/connections/${body.connection.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ signing_mode: 'delegated' }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it('DELETE revokes the connection and clears secrets', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const body = await createConnection(rig);
    const del = await rig.app.fetch(
      new Request(`http://test.local/v1/external/connections/${body.connection.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      }),
    );
    expect(del.status).toBe(200);
    const after = await rig.db.execute({
      sql: 'SELECT status, encrypted_credential, verification_token FROM external_connections WHERE id = ?',
      args: [body.connection.id],
    });
    const row = after.rows[0]!;
    expect(String(row.status)).toBe('revoked');
    expect(row.encrypted_credential).toBeNull();
    expect(row.verification_token).toBeNull();
  });
});

describe('external telegram webhook — phase 1', () => {
  async function postUpdate(
    rig: Awaited<ReturnType<typeof createTestRig>>,
    routingId: string,
    update: Record<string, unknown>,
  ) {
    return rig.app.fetch(
      new Request(`http://test.local/v1/external/telegram/webhook/${routingId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      }),
    );
  }

  it('drops messages for unknown routing_id with 200', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const res = await postUpdate(rig, 'not-a-real-hash', {
      message: { from: { id: 1 }, text: 'hi' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; dropped?: string };
    expect(body.dropped).toBe('unknown_routing_id');
  });

  it('binds connection on /start <token> and rejects subsequent messages from other senders', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const created = await createConnection(rig);
    const routingId = created.connection.routing_id;
    const verifyToken = created.connection.verification_token;

    const bind = await postUpdate(rig, routingId, {
      message: { from: { id: TELEGRAM_FROM_ID }, text: `/start ${verifyToken}` },
    });
    expect(bind.status).toBe(200);
    const bindBody = (await bind.json()) as { bound: boolean };
    expect(bindBody.bound).toBe(true);

    const after = await rig.db.execute({
      sql: 'SELECT status, bound_chat_id, verification_token FROM external_connections WHERE id = ?',
      args: [created.connection.id],
    });
    expect(String(after.rows[0]!.status)).toBe('connected');
    expect(String(after.rows[0]!.bound_chat_id)).toBe(TELEGRAM_FROM_ID);
    expect(after.rows[0]!.verification_token).toBeNull();

    const intruder = await postUpdate(rig, routingId, {
      message: { from: { id: '777999' }, text: 'pay alice 5 usdc' },
    });
    expect(intruder.status).toBe(200);
    const intruderBody = (await intruder.json()) as { dropped?: string };
    expect(intruderBody.dropped).toBe('unauthorized_sender');

    const owner = await postUpdate(rig, routingId, {
      message: { from: { id: TELEGRAM_FROM_ID }, text: 'show last receipt' },
    });
    expect(owner.status).toBe(200);
    const ownerBody = (await owner.json()) as { queued?: boolean };
    expect(ownerBody.queued).toBe(true);
  });

  it('replay of /start with a stale token is a no-op', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const created = await createConnection(rig);
    const routingId = created.connection.routing_id;
    const verifyToken = created.connection.verification_token;

    const first = await postUpdate(rig, routingId, {
      message: { from: { id: TELEGRAM_FROM_ID }, text: `/start ${verifyToken}` },
    });
    expect(((await first.json()) as { bound: boolean }).bound).toBe(true);

    const replay = await postUpdate(rig, routingId, {
      message: { from: { id: '111222333' }, text: `/start ${verifyToken}` },
    });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { bound: boolean };
    expect(replayBody.bound).toBe(false);
  });
});

describe('external approvals', () => {
  async function mintApproval(rig: Awaited<ReturnType<typeof createTestRig>>) {
    const created = await createConnection(rig);
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/external/approvals', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          connection_id: created.connection.id,
          agent_mint: MINT,
          tool_name: 'leash_pay_payment_link',
          payload: { url: 'https://api.leash.market/x/abc', max_usd: '5.00' },
        }),
      }),
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      approval: { token: string; tool_name: string; consumed_at: string | null };
      approve_url: string;
    };
  }

  it('mints an approval, exposes it on the public read endpoint, and consumes it once', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const minted = await mintApproval(rig);
    expect(minted.approval.consumed_at).toBeNull();
    expect(minted.approve_url).toContain(`/approve/${minted.approval.token}`);

    // Public read — no admin auth needed.
    const read = await rig.app.fetch(
      new Request(`http://test.local/v1/external/approvals/${minted.approval.token}`),
    );
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { tool_name: string; consumed_at: string | null };
    expect(readBody.tool_name).toBe('leash_pay_payment_link');
    expect(readBody.consumed_at).toBeNull();

    const RECEIPT = '0'.repeat(64);
    const consume = await rig.app.fetch(
      new Request(`http://test.local/v1/external/approvals/${minted.approval.token}/consume`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ receipt_hash: RECEIPT }),
      }),
    );
    expect(consume.status).toBe(200);
    const consumeBody = (await consume.json()) as {
      consumed: boolean;
      approval: { result_receipt_hash: string | null; consumed_at: string | null };
    };
    expect(consumeBody.consumed).toBe(true);
    expect(consumeBody.approval.result_receipt_hash).toBe(RECEIPT);
    expect(consumeBody.approval.consumed_at).not.toBeNull();

    const replay = await rig.app.fetch(
      new Request(`http://test.local/v1/external/approvals/${minted.approval.token}/consume`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ receipt_hash: RECEIPT }),
      }),
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { consumed: boolean }).consumed).toBe(false);
  });

  it('records error result on cancellation', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const minted = await mintApproval(rig);
    const consume = await rig.app.fetch(
      new Request(`http://test.local/v1/external/approvals/${minted.approval.token}/consume`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ error: 'user_cancelled' }),
      }),
    );
    expect(consume.status).toBe(200);
    const body = (await consume.json()) as {
      approval: { result_error: string | null; consumed_at: string | null };
    };
    expect(body.approval.result_error).toBe('user_cancelled');
    expect(body.approval.consumed_at).not.toBeNull();
  });

  it('returns 404 for unknown approval token (admin path) and public path', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET, encryptionKey: ENC_KEY });
    const pubRes = await rig.app.fetch(
      new Request('http://test.local/v1/external/approvals/does-not-exist'),
    );
    expect(pubRes.status).toBe(404);
    const adminRes = await rig.app.fetch(
      new Request('http://test.local/v1/external/approvals/does-not-exist/consume', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ error: 'x' }),
      }),
    );
    expect(adminRes.status).toBe(404);
  });
});

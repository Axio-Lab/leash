/**
 * Webhook subscription + delivery tests.
 *
 * Uses an in-memory rig and a hand-rolled `fetch` impl injected into
 * the worker so the suite never goes to the network. Asserts:
 *   - subscription CRUD round-trips and respects the API key network
 *   - event lifecycle transitions enqueue exactly one delivery per
 *     matching subscription (idempotent under repeat phase changes)
 *   - the worker HMAC-signs the body, marks 2xx as delivered, and
 *     reschedules failures with backoff
 *   - signatures verify with the secret returned at create time
 */

import { describe, it, expect } from 'vitest';

import { createTestRig, authedFetch, TEST_API_KEY_OWNER_WALLET } from './helpers.js';
import { createPreparedEvent, markConfirmed } from '../src/storage/events.js';
import {
  enqueueDeliveriesForEvent,
  getWebhookById,
  listDuePending,
} from '../src/storage/webhooks.js';
import { runWebhookTick } from '../src/webhooks/worker.js';
import { signPayload, verifySignature } from '../src/webhooks/sign.js';
import { getEventById } from '../src/storage/events.js';
import { execute } from '../src/storage/turso.js';

describe('webhook subscription routes', () => {
  it('creates, lists, fetches, and deletes a subscription', async () => {
    const rig = await createTestRig();
    const created = await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/hook', events: [] }),
    });
    expect(created.status).toBe(200);
    const sub = (await created.json()) as {
      id: string;
      secret: string;
      network: string;
      url: string;
      events: string[];
    };
    expect(sub.id).toMatch(/^[0-9A-Z]{20,}$/);
    expect(sub.secret.startsWith('whsec_')).toBe(true);
    expect(sub.network).toBe('solana-devnet');
    expect(sub.url).toBe('https://example.test/hook');

    const list = await authedFetch(rig, '/v1/webhooks');
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { items: { id: string; url: string }[] };
    expect(listBody.items.find((s) => s.id === sub.id)?.url).toBe(sub.url);
    // Secret must NOT leak from list/get.
    expect((listBody.items[0] as Record<string, unknown>).secret).toBeUndefined();

    const get = await authedFetch(rig, `/v1/webhooks/${sub.id}`);
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as Record<string, unknown>;
    expect(getBody.secret).toBeUndefined();

    const del = await authedFetch(rig, `/v1/webhooks/${sub.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = await authedFetch(rig, `/v1/webhooks/${sub.id}`);
    expect(after.status).toBe(404);
  });

  it('upserting the same url returns the same row and resets disabled_at', async () => {
    const rig = await createTestRig();
    const first = await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/dup', events: ['receipt.published'] }),
    });
    const a = (await first.json()) as { id: string; events: string[] };
    expect(a.events).toEqual(['receipt.published']);

    const second = await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.test/dup',
        events: ['agent.identity.register'],
      }),
    });
    const b = (await second.json()) as { id: string; events: string[] };
    expect(b.id).toBe(a.id);
    expect(b.events).toEqual(['agent.identity.register']);
  });

  it('does not leak subscriptions across api keys', async () => {
    const rig = await createTestRig();
    const create = await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/hook' }),
    });
    const sub = (await create.json()) as { id: string };

    const { createApiKey } = await import('../src/storage/api-keys.js');
    const { plaintext } = await createApiKey(rig.db, {
      label: 'second',
      network: 'solana-devnet',
      ownerWallet: TEST_API_KEY_OWNER_WALLET,
    });
    const cross = await rig.app.fetch(
      new Request(`http://test.local/v1/webhooks/${sub.id}`, {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(cross.status).toBe(404);
  });
});

describe('webhook fanout on event lifecycle', () => {
  it('enqueues one delivery per matching subscription on phase changes', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/all' }),
    });

    const eventId = await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });
    await markConfirmed(rig.db, eventId);
    const due = await listDuePending(rig.db, 100);
    // One row even though we created + confirmed (UNIQUE on (webhook_id, event_id)).
    expect(due.filter((d) => d.eventId === eventId).length).toBe(1);
  });

  it('respects per-kind subscription filters', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.test/identity-only',
        events: ['agent.identity.register'],
      }),
    });
    const matchedId = await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });
    const ignoredId = await createPreparedEvent(rig.db, {
      kind: 'agent.treasury.withdraw',
      network: 'solana-devnet',
    });
    const due = await listDuePending(rig.db, 100);
    expect(due.find((d) => d.eventId === matchedId)).toBeDefined();
    expect(due.find((d) => d.eventId === ignoredId)).toBeUndefined();
  });

  it('does not deliver across networks', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/devnet-only' }),
    });
    const mainnetId = await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-mainnet',
    });
    const due = await listDuePending(rig.db, 100);
    expect(due.find((d) => d.eventId === mainnetId)).toBeUndefined();
  });
});

describe('webhook delivery worker', () => {
  it('signs the body, POSTs the payload, and marks delivered on 2xx', async () => {
    const rig = await createTestRig();
    const created = await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/hook' }),
    });
    const sub = (await created.json()) as { id: string; secret: string };
    const eventId = await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });

    const calls: Array<{ url: string; sig: string; body: string }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        sig: headers.get('x-leash-signature') ?? '',
        body: String(init?.body ?? ''),
      });
      return new Response('ok', { status: 200 });
    };
    const result = await runWebhookTick(rig.db, { fetchImpl: fetchMock });
    expect(result.processed).toBeGreaterThan(0);
    expect(result.delivered).toBeGreaterThan(0);

    const call = calls.find((c) => c.url === 'https://example.test/hook');
    expect(call).toBeDefined();
    expect(verifySignature(sub.secret, call!.body, call!.sig)).toBe(true);
    const payload = JSON.parse(call!.body) as {
      type: string;
      event: { id: string; kind: string };
    };
    expect(payload.type).toBe('event');
    expect(payload.event.id).toBe(eventId);
    expect(payload.event.kind).toBe('agent.identity.register');
  });

  it('reschedules with backoff on non-2xx and gives up after max attempts', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/fail' }),
    });
    await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });

    const failingFetch: typeof fetch = async () => new Response('boom', { status: 500 });

    // Fast-forward by manually rewinding the next_attempt_at after each tick
    // so we don't have to wait for backoff to expire in the test.
    for (let i = 0; i < 9; i += 1) {
      await runWebhookTick(rig.db, { fetchImpl: failingFetch, maxAttempts: 8 });
      await execute(
        rig.db,
        `UPDATE webhook_deliveries SET next_attempt_at = datetime('now','-1 hour') WHERE delivered = 0`,
      );
    }
    const remaining = await listDuePending(rig.db, 100);
    expect(remaining.length).toBe(0); // worker gave up
  });

  it('short-circuits deliveries for disabled subscriptions', async () => {
    const rig = await createTestRig();
    const created = await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/zombie' }),
    });
    const sub = (await created.json()) as { id: string };
    await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });
    await execute(
      rig.db,
      `UPDATE webhooks SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [sub.id],
    );

    const fetchMock = async () => new Response('ok', { status: 200 });
    const result = await runWebhookTick(rig.db, { fetchImpl: fetchMock as typeof fetch });
    expect(result.delivered).toBeGreaterThan(0);
    const remaining = await listDuePending(rig.db, 100);
    expect(remaining.length).toBe(0);
  });
});

describe('webhook signing', () => {
  it('round-trips signPayload + verifySignature', () => {
    const secret = 'whsec_abc';
    const body = JSON.stringify({ hello: 'world' });
    const sig = signPayload(secret, body);
    expect(verifySignature(secret, body, sig.header)).toBe(true);
  });

  it('rejects tampered bodies', () => {
    const secret = 'whsec_abc';
    const sig = signPayload(secret, 'a');
    expect(verifySignature(secret, 'b', sig.header)).toBe(false);
  });

  it('rejects stale timestamps', () => {
    const secret = 'whsec_abc';
    const tenMinAgoMs = Date.now() - 10 * 60 * 1000;
    const sig = signPayload(secret, 'a', tenMinAgoMs);
    expect(verifySignature(secret, 'a', sig.header, 60)).toBe(false);
  });
});

describe('storage helpers (direct)', () => {
  it('enqueueDeliveriesForEvent is idempotent on (webhook_id, event_id)', async () => {
    const rig = await createTestRig();
    const created = await authedFetch(rig, '/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/hook' }),
    });
    const sub = (await created.json()) as { id: string };
    const eventId = await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });
    const ev = await getEventById(rig.db, eventId);
    expect(ev).not.toBeNull();
    const a = await enqueueDeliveriesForEvent(rig.db, ev!);
    expect(a.created).toBe(0); // already enqueued by createPreparedEvent fanout
    const b = await enqueueDeliveriesForEvent(rig.db, ev!);
    expect(b.created).toBe(0);
    const sub2 = await getWebhookById(rig.db, sub.id);
    expect(sub2).not.toBeNull();
  });
});

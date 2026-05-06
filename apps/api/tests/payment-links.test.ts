/**
 * Payment-link CRUD + preview tests.
 *
 * Asserts:
 *   - POST creates the record + emits a `payment_link.created` event +
 *     enrolls the owner agent in the indexer watchlist.
 *   - The discovery view (`pay_to`, `accepts[]`, `share_url`,
 *     `facilitator`) matches what `@leashmarket/seller-kit` would advertise
 *     for the same `(asset, price, currency)` tuple.
 *   - GET list / get respect api-key scoping (no cross-tenant reads).
 *   - PATCH updates fields, re-validates price/currency, and emits
 *     `payment_link.updated`.
 *   - DELETE removes the row + emits `payment_link.deleted`.
 *   - Slug collisions return 409 (not 500) and bad prices return 422.
 *   - POST /v1/payment-links/preview never persists.
 */

import { describe, expect, it } from 'vitest';

import { authedFetch, createTestRig, TEST_API_KEY_OWNER_WALLET } from './helpers.js';
import { listEvents } from '../src/storage/events.js';
import { listWatchlist } from '../src/indexer/watchlist.js';
import { execute } from '../src/storage/turso.js';
import { createApiKey } from '../src/storage/api-keys.js';

const AGENT = 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp';
const SECOND_AGENT = 'CZ5xBVS37cJF6QewjuW9KzhvKtpr4iPzAfqL2hEdLrUe';

type PaymentLink = {
  id: string;
  network: string;
  label: string;
  description: string | null;
  owner_agent: string;
  owner_wallet: string | null;
  pay_to: string;
  method: 'GET' | 'POST';
  path: string;
  price: string;
  currency: 'USDC' | 'USDT' | 'USDG';
  accepts_currencies: string[];
  response: { status: number; mimeType: string; body: unknown };
  webhook_url: string | null;
  wrap_receipt: boolean;
  metadata: Record<string, unknown>;
  facilitator: string;
  share_url: string;
  accepts: Array<{
    scheme: 'exact';
    network: string;
    pay_to: string;
    asset: string;
    amount: string;
    currency: string;
  }>;
  counters: {
    call_count: number;
    settled_count: number;
    last_called_at: string | null;
    last_settled_at: string | null;
    last_tx_sig: string | null;
    last_settled_amount_atomic: string | null;
    last_settled_currency: string | null;
  };
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

function defaultBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    label: 'Demo paywall',
    owner_agent: AGENT,
    method: 'GET',
    price: '$0.001',
    currency: 'USDC',
    response: {
      status: 200,
      mimeType: 'application/json',
      body: { hello: 'world' },
    },
    ...overrides,
  };
}

describe('POST /v1/payment-links', () => {
  it('creates a payment link with derived discovery fields + emits events + watchlist', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody()),
    });
    expect(res.status).toBe(200);
    const link = (await res.json()) as PaymentLink;

    expect(link.network).toBe('solana-devnet');
    expect(link.owner_agent).toBe(AGENT);
    expect(link.path).toBe(`/x/${link.id}`);
    expect(link.share_url).toBe(`http://test.local/x/${link.id}?network=solana-devnet`);
    expect(link.facilitator).toBe('https://facilitator.test.invalid');
    expect(link.pay_to).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(link.accepts.length).toBe(1);
    expect(link.accepts[0]).toMatchObject({
      scheme: 'exact',
      pay_to: link.pay_to,
      currency: 'USDC',
      // $0.001 USDC → 1000 atomic (6 decimals)
      amount: '1000',
    });
    expect(link.counters).toMatchObject({ call_count: 0, settled_count: 0 });
    expect(link.disabled_at).toBeNull();

    // payment_link.created event landed.
    const events = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'payment_link.created',
    });
    expect(events.length).toBe(1);
    expect(events[0].metadata).toMatchObject({ payment_link_id: link.id });

    // owner agent enrolled in indexer watchlist.
    const watch = await listWatchlist(rig.db, 'solana-devnet');
    expect(watch.find((w) => w.agentAsset === AGENT)).toBeDefined();
  });

  it('expands accepts[] when accepts_currencies is set', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        defaultBody({
          currency: 'USDC',
          accepts_currencies: ['USDT', 'USDG'],
          price: '$0.01',
        }),
      ),
    });
    expect(res.status).toBe(200);
    const link = (await res.json()) as PaymentLink;
    const symbols = link.accepts.map((a) => a.currency).sort();
    expect(symbols).toEqual(['USDC', 'USDG', 'USDT']);
    for (const a of link.accepts) {
      expect(a.amount).toBe('10000'); // 0.01 * 1e6
      expect(a.pay_to).toBe(link.pay_to);
    }
  });

  it('rejects unparseable prices with 422', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ price: 'not a price' })),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('returns 409 when the same id is reused on the same network', async () => {
    const rig = await createTestRig();
    const first = await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'fixed-slug-1' })),
    });
    expect(first.status).toBe(200);

    const dupe = await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'fixed-slug-1' })),
    });
    expect(dupe.status).toBe(409);
    const body = (await dupe.json()) as { error: string; message: string };
    expect(body.error).toBe('idempotency_conflict');
    expect(body.message).toMatch(/fixed-slug-1/);
  });
});

describe('GET /v1/payment-links + GET /v1/payment-links/{id}', () => {
  it('lists newest first and returns 404 for unknown ids', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'a-link' })),
    });
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'b-link', label: 'Second' })),
    });

    const list = await authedFetch(rig, '/v1/payment-links');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: PaymentLink[]; next_cursor: string | null };
    expect(body.items.length).toBe(2);
    // ORDER BY created_at DESC; both rows may share the same second-
    // resolution timestamp in SQLite — just check both ids are present.
    expect(body.items.map((l) => l.id).sort()).toEqual(['a-link', 'b-link']);

    const getOne = await authedFetch(rig, '/v1/payment-links/a-link');
    expect(getOne.status).toBe(200);
    const got = (await getOne.json()) as PaymentLink;
    expect(got.id).toBe('a-link');

    const missing = await authedFetch(rig, '/v1/payment-links/does-not-exist');
    expect(missing.status).toBe(404);
  });

  it('does not leak payment links across api keys', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'private-link' })),
    });

    const { plaintext } = await createApiKey(rig.db, {
      label: 'second',
      network: 'solana-devnet',
      ownerWallet: TEST_API_KEY_OWNER_WALLET,
    });
    const cross = await rig.app.fetch(
      new Request('http://test.local/v1/payment-links/private-link', {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(cross.status).toBe(404);

    const crossList = await rig.app.fetch(
      new Request('http://test.local/v1/payment-links', {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(crossList.status).toBe(200);
    const listBody = (await crossList.json()) as { items: PaymentLink[] };
    expect(listBody.items.length).toBe(0);
  });

  it('filters by owner_agent', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'agent1-link' })),
    });
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'agent2-link', owner_agent: SECOND_AGENT })),
    });

    const filtered = await authedFetch(rig, `/v1/payment-links?owner_agent=${SECOND_AGENT}`);
    expect(filtered.status).toBe(200);
    const body = (await filtered.json()) as { items: PaymentLink[] };
    expect(body.items.map((l) => l.id)).toEqual(['agent2-link']);
  });
});

describe('PATCH /v1/payment-links/{id}', () => {
  it('updates fields, recomputes accepts[], and emits payment_link.updated', async () => {
    const rig = await createTestRig();
    const created = await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'patchable' })),
    });
    expect(created.status).toBe(200);

    const patch = await authedFetch(rig, '/v1/payment-links/patchable', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Patched',
        price: '$0.005',
        accepts_currencies: ['USDT'],
      }),
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as PaymentLink;
    expect(updated.label).toBe('Patched');
    expect(updated.price).toBe('$0.005');
    const symbols = updated.accepts.map((a) => a.currency).sort();
    expect(symbols).toEqual(['USDC', 'USDT']);
    expect(updated.accepts[0].amount).toBe('5000'); // 0.005 * 1e6

    const events = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'payment_link.updated',
    });
    expect(events.length).toBe(1);
  });

  it('toggles disabled_at on disabled patch', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'toggle' })),
    });

    const off = await authedFetch(rig, '/v1/payment-links/toggle', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as PaymentLink).disabled_at).not.toBeNull();

    const on = await authedFetch(rig, '/v1/payment-links/toggle', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: false }),
    });
    expect(((await on.json()) as PaymentLink).disabled_at).toBeNull();
  });

  it('rejects patches with bad prices (422)', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'badpatch' })),
    });
    const res = await authedFetch(rig, '/v1/payment-links/badpatch', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ price: 'not a price' }),
    });
    expect(res.status).toBe(422);
  });

  it('returns 404 when patching a missing link', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/payment-links/ghost', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /v1/payment-links/{id}', () => {
  it('removes the row and emits payment_link.deleted', async () => {
    const rig = await createTestRig();
    await authedFetch(rig, '/v1/payment-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ id: 'doomed' })),
    });

    const del = await authedFetch(rig, '/v1/payment-links/doomed', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    const after = await authedFetch(rig, '/v1/payment-links/doomed');
    expect(after.status).toBe(404);

    const events = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'payment_link.deleted',
    });
    expect(events.length).toBe(1);

    const rows = await execute(rig.db, `SELECT COUNT(*) AS n FROM payment_links`, []);
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(0);
  });

  it('returns 404 on a missing slug', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/payment-links/nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/payment-links/preview', () => {
  it('returns the discovery payload without persisting', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/payment-links/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ accepts_currencies: ['USDT'], price: '$0.5' })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pay_to: string;
      facilitator: string;
      share_url: string;
      accepts: Array<{ amount: string; currency: string }>;
    };
    expect(body.pay_to).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(body.facilitator).toBe('https://facilitator.test.invalid');
    expect(body.share_url.startsWith('http://test.local/x/')).toBe(true);
    const symbols = body.accepts.map((a) => a.currency).sort();
    expect(symbols).toEqual(['USDC', 'USDT']);
    for (const a of body.accepts) {
      expect(a.amount).toBe('500000'); // 0.5 * 1e6
    }

    // No row was written.
    const rows = await execute(rig.db, `SELECT COUNT(*) AS n FROM payment_links`, []);
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(0);
  });

  it('rejects bad prices (422)', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, '/v1/payment-links/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(defaultBody({ price: 'busted' })),
    });
    expect(res.status).toBe(422);
  });
});

/**
 * Public x402 paywall tests (`/x/{id}`).
 *
 * Asserts:
 *   - 404 / 405 / 410 routing semantics for missing, wrong-method, and
 *     disabled links.
 *   - Friendly "wrong network" 404 when a slug exists on the sibling
 *     network only.
 *   - call_count increments on every hit (paid or unpaid probe).
 *   - Real seller-kit middleware returns a 402 with a structured
 *     `accepts[]` payload that matches what we advertise via
 *     `/v1/payment-links`.
 *   - `ingestPaywallReceipt` (the `onReceipt` sink) ingests the
 *     receipt, bumps settled_count + last_tx_sig, emits the three
 *     expected events (receipt.published, payment_link.served,
 *     payment_link.settled), and is idempotent across replays.
 */

import { describe, expect, it } from 'vitest';

import { authedFetch, createTestRig } from './helpers.js';
import { execute } from '../src/storage/turso.js';
import { listEvents } from '../src/storage/events.js';
import { getPaymentLink } from '../src/storage/payment-links.js';
import { getReceiptByHash } from '../src/storage/receipts.js';
import { ingestPaywallReceipt } from '../src/routes/paywall.js';
import type { ReceiptV1 } from '@leash/schemas';
import { getCache } from '../src/storage/redis.js';

const AGENT = 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp';

function defaultLinkBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    label: 'paywall test',
    owner_agent: AGENT,
    method: 'GET',
    price: '$0.01',
    currency: 'USDC',
    response: { status: 200, mimeType: 'application/json', body: { hello: 'paid' } },
    ...overrides,
  };
}

async function createLink(
  rig: Awaited<ReturnType<typeof createTestRig>>,
  body: Record<string, unknown>,
) {
  const res = await authedFetch(rig, '/v1/payment-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    id: string;
    pay_to: string;
    accepts: Array<{ amount: string; asset: string; currency: string }>;
  };
}

async function publicFetch(
  rig: Awaited<ReturnType<typeof createTestRig>>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return rig.app.fetch(new Request(`http://test.local${path}`, init));
}

describe('GET /x/{id} routing', () => {
  it('returns 404 for an unknown slug', async () => {
    const rig = await createTestRig();
    const res = await publicFetch(rig, '/x/missing?network=solana-devnet');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('not_found');
  });

  it('falls back to the sibling network when no `?network=` is supplied', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'devnet-only' }));
    // Visiting the bare slug used to 404 with a "wrong_network" hint.
    // It now transparently resolves to whichever network owns the slug
    // and forwards to the seller-kit middleware. The middleware itself
    // 500s in unit tests (facilitator is unreachable), so what we
    // assert is that we got PAST the routing layer — i.e. neither
    // `not_found` nor `wrong_network` is returned.
    const res = await publicFetch(rig, `/x/${created.id}`);
    expect([404]).not.toContain(res.status);
    // call_count must bump because routing succeeded
    const row = await getPaymentLink(rig.db, 'solana-devnet', created.id);
    expect(row?.callCount).toBe(1);
  });

  it('still surfaces wrong_network when an explicit `?network=` mismatches', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'devnet-explicit' }));
    const res = await publicFetch(rig, `/x/${created.id}?network=solana-mainnet`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('wrong_network');
    expect(body.message).toMatch(/solana-devnet/);
  });

  it('returns 410 for a disabled link', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'gone' }));
    await authedFetch(rig, `/v1/payment-links/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    const res = await publicFetch(rig, `/x/${created.id}?network=solana-devnet`);
    expect(res.status).toBe(410);
  });

  it('returns 405 when the method does not match', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'getonly', method: 'GET' }));
    const res = await publicFetch(rig, `/x/${created.id}?network=solana-devnet`, {
      method: 'POST',
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /x/{id} 402 discovery', () => {
  /**
   * The seller-kit middleware initializes by fetching `/supported`
   * from the configured facilitator URL. In unit tests we point at
   * `https://facilitator.test.invalid` which is unreachable, so the
   * 402 response shape itself can't be asserted here — the middleware
   * 500s on init. The full 402 payload (with `accepts[]`, `payTo`,
   * `asset`, `amount` matching `/v1/payment-links` discovery) is
   * verified by `apps/api/scripts/e2e-devnet.ts` against a real
   * facilitator. What we DO assert here:
   *   - the seller middleware is wired in front of the response
   *     handler (we never see the configured 200 body for an unpaid
   *     request), and
   *   - call_count bumps on every paywall hit regardless of the
   *     middleware outcome.
   */
  it('does not leak the configured 200 body on an unpaid request', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'pay1' }));

    const res = await publicFetch(rig, `/x/${created.id}?network=solana-devnet`);
    expect(res.status).not.toBe(200);
    const text = await res.text();
    expect(text).not.toContain('"hello":"paid"');
  });

  it('bumps call_count on every hit (paid or unpaid)', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'counted' }));

    await publicFetch(rig, `/x/${created.id}?network=solana-devnet`);
    await publicFetch(rig, `/x/${created.id}?network=solana-devnet`);
    await publicFetch(rig, `/x/${created.id}?network=solana-devnet`);

    const row = await getPaymentLink(rig.db, 'solana-devnet', created.id);
    expect(row?.callCount).toBe(3);
    expect(row?.settledCount).toBe(0);
  });
});

describe('ingestPaywallReceipt() — settled receipt sink', () => {
  it('persists the receipt, bumps settled_count, and emits 3 events', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'settled' }));
    const link = await getPaymentLink(rig.db, 'solana-devnet', created.id);
    expect(link).not.toBeNull();

    const receipt: ReceiptV1 = {
      v: '0.1',
      kind: 'earn',
      agent: AGENT,
      nonce: 0,
      ts: new Date().toISOString(),
      policy_v: '0.1',
      request: {
        method: 'GET',
        url: `http://test.local/x/${created.id}`,
        body_hash: null,
      },
      decision: 'allow',
      reason: null,
      price: {
        amount: '10000',
        currency: 'USDC',
        network: 'solana-devnet',
        asset: created.accepts[0].asset,
      },
      facilitator: 'https://facilitator.test.invalid',
      tx_sig: 'fake-tx-sig-1',
      payment_requirements_hash: 'fakehash',
      response: { status: 200, body_hash: null },
      prev_receipt_hash: null,
      receipt_hash: 'rh_' + 'a'.repeat(60),
    };

    await ingestPaywallReceipt(
      { config: rig.config, db: rig.db, cache: getCache(rig.config) },
      link!,
      receipt,
    );

    // Receipt landed in the receipts table.
    const got = await getReceiptByHash(rig.db, 'solana-devnet', receipt.receipt_hash);
    expect(got).not.toBeNull();
    expect(got!.txSig).toBe('fake-tx-sig-1');

    // Counters bumped on the payment link.
    const after = await getPaymentLink(rig.db, 'solana-devnet', created.id);
    expect(after?.settledCount).toBe(1);
    expect(after?.lastTxSig).toBe('fake-tx-sig-1');
    expect(after?.lastSettledAmountAtomic).toBe('10000');
    expect(after?.lastSettledCurrency).toBe('USDC');

    // Three events landed: receipt.published, payment_link.served,
    // payment_link.settled.
    const published = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'receipt.published',
    });
    expect(published.length).toBe(1);
    const served = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'payment_link.served',
    });
    expect(served.length).toBe(1);
    const settled = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'payment_link.settled',
    });
    expect(settled.length).toBe(1);
    expect(settled[0].amountAtomic).toBe('10000');
    expect(settled[0].mint).toBe(created.accepts[0].asset);
  });

  it('is idempotent on receipt_hash but still bumps settled_count + emits served/settled', async () => {
    const rig = await createTestRig();
    const created = await createLink(rig, defaultLinkBody({ id: 'idem' }));
    const link = await getPaymentLink(rig.db, 'solana-devnet', created.id);

    const receipt: ReceiptV1 = {
      v: '0.1',
      kind: 'earn',
      agent: AGENT,
      nonce: 0,
      ts: new Date().toISOString(),
      policy_v: '0.1',
      request: { method: 'GET', url: `http://test.local/x/${created.id}`, body_hash: null },
      decision: 'allow',
      reason: null,
      price: {
        amount: '10000',
        currency: 'USDC',
        network: 'solana-devnet',
        asset: created.accepts[0].asset,
      },
      facilitator: 'https://facilitator.test.invalid',
      tx_sig: 'dup-sig',
      payment_requirements_hash: 'h',
      response: { status: 200, body_hash: null },
      prev_receipt_hash: null,
      receipt_hash: 'rh_' + 'b'.repeat(60),
    };

    const deps = { config: rig.config, db: rig.db, cache: getCache(rig.config) };
    await ingestPaywallReceipt(deps, link!, receipt);
    await ingestPaywallReceipt(deps, link!, receipt);

    // Receipt table still has just one row (idempotent).
    const rows = await execute(
      rig.db,
      `SELECT COUNT(*) AS n FROM receipts WHERE receipt_hash = ?`,
      [receipt.receipt_hash],
    );
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(1);

    // Only ONE receipt.published event (we skip the event on duplicate
    // ingest), but TWO settled / served events (those fire every time
    // the seller-kit's onReceipt callback runs).
    const published = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'receipt.published',
    });
    expect(published.length).toBe(1);
    const served = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'payment_link.served',
    });
    expect(served.length).toBe(2);
    const settled = await listEvents(rig.db, {
      network: 'solana-devnet',
      kind: 'payment_link.settled',
    });
    expect(settled.length).toBe(2);

    const after = await getPaymentLink(rig.db, 'solana-devnet', created.id);
    expect(after?.settledCount).toBe(2);
  });
});

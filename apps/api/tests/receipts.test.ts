import { describe, it, expect } from 'vitest';
import { finalizeReceipt } from '@leash/core';

import { createTestRig, authedFetch } from './helpers.js';
import { createApiKey } from '../src/storage/api-keys.js';

// Distinct agent pubkeys per test case so the shared in-memory DB
// (`file::memory:?cache=shared`) does not let one test's rows pollute
// another test's filters.
const AGENT_A = 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp';
const AGENT_B = '8x7nQv2C8j7e6jK6YwCmcEHEFDxFR6PAYgFdLP6L4tPP';
const AGENT_C = '5LBJjqMmF93HGT8Yy4hQ3rGqUoDMxkRHr8mD1Ww4G24S';
const AGENT_D = 'AkV6Ka5KjAjm9SmZbpTzo3rkmmSJzaWRrgRTeqdnKkty';
const AGENT_E = '7PYf2VmAyhshFY3uxHGsNqHRYS41ZGvw9wKzTjp9X9HE';
const AGENT_F = '2GBAUk6h6cdczDMkYLnnECpA7TPvm9oQGgwqEZRQRpcM';

function makeReceipt(
  opts: {
    agent?: string;
    nonce?: number;
    ts?: string;
    tx_sig?: string | null;
  } = {},
) {
  return finalizeReceipt({
    v: '0.1',
    kind: 'spend',
    agent: opts.agent ?? AGENT_A,
    nonce: opts.nonce ?? 0,
    ts: opts.ts ?? '2026-04-23T12:00:00.000Z',
    policy_v: '0.1',
    request: {
      method: 'POST',
      url: 'http://merchant.test/echo',
      body_hash: null,
    },
    decision: 'allow',
    reason: null,
    price: { amount: '0.01', currency: 'USDC' },
    facilitator: 'https://devnet-facilitator.leash.market',
    tx_sig: opts.tx_sig ?? null,
    response: { status: 200, body_hash: null },
    prev_receipt_hash: null,
  });
}

/**
 * These tests exercise the full receipt ingest -> read -> by-hash ->
 * pull-target lifecycle through the Hono app. They guarantee:
 *   - receipt hashes are network-isolated (devnet hash not visible from mainnet key),
 *   - re-posting the same receipt is idempotent and does NOT spawn a
 *     duplicate `receipt.published` event,
 *   - the events feed includes new receipt rows,
 *   - pull-targets list back the URL we just registered.
 */
describe('receipts ingest + read', () => {
  it('POST /v1/receipts/{agent} ingests, dedups, and lists', async () => {
    const rig = await createTestRig();
    const r = makeReceipt({
      tx_sig: 'devnetSig11111111111111111111111111111111111111111111111111111111',
    });
    // First ingest -> 200, duplicate=false, event_id present.
    const first = await authedFetch(rig, `/v1/receipts/${AGENT_A}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      ok: boolean;
      receipt_hash: string;
      duplicate: boolean;
      event_id: string | null;
    };
    expect(firstBody.ok).toBe(true);
    expect(firstBody.duplicate).toBe(false);
    expect(firstBody.receipt_hash).toBe(r.receipt_hash);
    expect(firstBody.event_id).toMatch(/^[0-9A-Z]{20,}$/);

    // Second ingest -> 200, duplicate=true, event_id null (no new event row).
    const dup = await authedFetch(rig, `/v1/receipts/${AGENT_A}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    expect(dup.status).toBe(200);
    const dupBody = (await dup.json()) as { duplicate: boolean; event_id: string | null };
    expect(dupBody.duplicate).toBe(true);
    expect(dupBody.event_id).toBeNull();

    // Read it back via the per-agent feed.
    const list = await authedFetch(rig, `/v1/receipts/${AGENT_A}`);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      items: Array<{ receipt_hash: string; tx_sig: string | null }>;
    };
    expect(listBody.items.length).toBe(1);
    expect(listBody.items[0]!.receipt_hash).toBe(r.receipt_hash);

    // Read it back via direct hash lookup.
    const byHash = await authedFetch(rig, `/v1/receipts/by-hash/${r.receipt_hash}`);
    expect(byHash.status).toBe(200);
    const byHashBody = (await byHash.json()) as { agent: string; tx_sig: string | null };
    expect(byHashBody.agent).toBe(AGENT_A);
  });

  it('rejects POST when receipt.agent !== path agent', async () => {
    const rig = await createTestRig();
    const r = makeReceipt({ agent: AGENT_B });
    const res = await authedFetch(rig, `/v1/receipts/${AGENT_C}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    expect(res.status).toBe(422);
  });

  it('returns 404 for receipt hashes from another network', async () => {
    const rig = await createTestRig();
    // Insert one receipt on mainnet directly via the storage layer.
    const { ingestReceipt } = await import('../src/storage/receipts.js');
    const r = makeReceipt({ agent: AGENT_D, ts: '2026-05-01T00:00:00.000Z' });
    await ingestReceipt(rig.db, { network: 'solana-mainnet', receipt: r });
    // Devnet key should not see it.
    const res = await authedFetch(rig, `/v1/receipts/by-hash/${r.receipt_hash}`);
    expect(res.status).toBe(404);
  });

  it('registers a receipts pull-target and lists it back', async () => {
    const rig = await createTestRig();
    const url = 'https://merchant.example.test/api/agents/{agent}/receipts.jsonl';
    const res = await authedFetch(rig, `/v1/agents/${AGENT_E}/pull-target`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      pull_targets: Array<{ url: string; network: string; agent: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.pull_targets).toHaveLength(1);
    expect(body.pull_targets[0]!.url).toBe(url);
    expect(body.pull_targets[0]!.agent).toBe(AGENT_E);
    expect(body.pull_targets[0]!.network).toBe('solana-devnet');

    // Re-register same URL -> idempotent (still one row).
    const again = await authedFetch(rig, `/v1/agents/${AGENT_E}/pull-target`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const againBody = (await again.json()) as { pull_targets: unknown[] };
    expect(againBody.pull_targets).toHaveLength(1);
  });

  it('emits a single protocol.fee.collected event when an earn receipt with price.fee is ingested', async () => {
    const rig = await createTestRig();
    const r = finalizeReceipt({
      v: '0.1',
      kind: 'earn',
      agent: AGENT_F,
      nonce: 1,
      ts: '2026-07-01T00:00:00.000Z',
      policy_v: '0.1',
      request: {
        method: 'POST',
        url: 'http://merchant.test/echo',
        body_hash: null,
      },
      decision: 'allow',
      reason: null,
      price: {
        amount: '1000000',
        currency: 'USDC',
        network: 'solana-devnet',
        asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        fee: '10000',
        gross: '1010000',
        feeBps: 100,
        feeAuthority: '3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W',
      },
      facilitator: 'https://devnet-facilitator.leash.market',
      tx_sig: 'feeSig11111111111111111111111111111111111111111111111111111111aa',
      response: { status: 200, body_hash: null },
      prev_receipt_hash: null,
    });

    // First ingest -> protocol.fee.collected event row should appear.
    const first = await authedFetch(rig, `/v1/receipts/${AGENT_F}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    expect(first.status).toBe(200);

    const { listEvents } = await import('../src/storage/events.js');
    const after = await listEvents(rig.db, {
      kind: 'protocol.fee.collected',
      network: 'solana-devnet',
      limit: 10,
    });
    expect(after.length).toBeGreaterThanOrEqual(1);
    const row = after.find((e) => {
      const md = e.metadata as Record<string, unknown> | null;
      return md?.['receipt_hash'] === r.receipt_hash;
    });
    expect(row).toBeDefined();
    expect(row!.amountAtomic).toBe('10000');
    expect(row!.mint).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    const md = row!.metadata as Record<string, unknown>;
    expect(md['fee_amount']).toBe('10000');
    expect(md['gross_amount']).toBe('1010000');
    expect(md['net_amount']).toBe('1000000');
    expect(md['fee_bps']).toBe(100);
    expect(md['fee_authority']).toBe('3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W');
    expect(md['currency']).toBe('USDC');

    // Re-ingest the same receipt -> NO duplicate fee event.
    const dup = await authedFetch(rig, `/v1/receipts/${AGENT_F}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    expect(dup.status).toBe(200);
    const afterDup = await listEvents(rig.db, {
      kind: 'protocol.fee.collected',
      network: 'solana-devnet',
      limit: 50,
    });
    const matches = afterDup.filter((e) => {
      const m = e.metadata as Record<string, unknown> | null;
      return m?.['receipt_hash'] === r.receipt_hash;
    });
    expect(matches.length).toBe(1);
  });

  it('does NOT emit a protocol.fee.collected event when the earn receipt carries no fee', async () => {
    const rig = await createTestRig();
    const r = finalizeReceipt({
      v: '0.1',
      kind: 'earn',
      agent: AGENT_E,
      nonce: 2,
      ts: '2026-07-02T00:00:00.000Z',
      policy_v: '0.1',
      request: {
        method: 'POST',
        url: 'http://merchant.test/echo',
        body_hash: null,
      },
      decision: 'allow',
      reason: null,
      price: { amount: '1000000', currency: 'USDC' },
      facilitator: 'https://devnet-facilitator.leash.market',
      tx_sig: 'noFeeSig111111111111111111111111111111111111111111111111111111aa',
      response: { status: 200, body_hash: null },
      prev_receipt_hash: null,
    });
    const res = await authedFetch(rig, `/v1/receipts/${AGENT_E}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    expect(res.status).toBe(200);
    const { listEvents } = await import('../src/storage/events.js');
    const events = await listEvents(rig.db, {
      kind: 'protocol.fee.collected',
      network: 'solana-devnet',
      limit: 50,
    });
    const matches = events.filter((e) => {
      const m = e.metadata as Record<string, unknown> | null;
      return m?.['receipt_hash'] === r.receipt_hash;
    });
    expect(matches.length).toBe(0);
  });

  it('writes a receipt.published event into the events feed on first ingest only', async () => {
    const rig = await createTestRig();
    const r = makeReceipt({ agent: AGENT_F, ts: '2026-06-01T00:00:00.000Z' });
    // Ingest twice — the second is a duplicate and must not show up as a new event.
    await authedFetch(rig, `/v1/receipts/${AGENT_F}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    await authedFetch(rig, `/v1/receipts/${AGENT_F}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
    // Filter by agent_asset to avoid pollution from other tests in the
    // same shared in-memory DB.
    const ev = await authedFetch(rig, `/v1/events?kind=receipt.published&agent=${AGENT_F}`);
    expect(ev.status).toBe(200);
    const evBody = (await ev.json()) as {
      items: Array<{ kind: string; agent_asset: string; phase: string }>;
    };
    expect(evBody.items).toHaveLength(1);
    expect(evBody.items[0]!.kind).toBe('receipt.published');
    expect(evBody.items[0]!.agent_asset).toBe(AGENT_F);
    expect(evBody.items[0]!.phase).toBe('confirmed');
  });

  it("cannot read another network's receipts feed even with a valid devnet key", async () => {
    const rig = await createTestRig();
    // Make a mainnet key on the same DB so we can post a receipt there.
    const mainnetKey = await createApiKey(rig.db, {
      label: 'test-mainnet',
      network: 'solana-mainnet',
      ownerWallet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    });
    const headers = new Headers({
      authorization: `Bearer ${mainnetKey.plaintext}`,
      'content-type': 'application/json',
    });
    const r = makeReceipt({ agent: AGENT_B, ts: '2026-07-01T00:00:00.000Z' });
    const post = await rig.app.fetch(
      new Request(`http://test.local/v1/receipts/${AGENT_B}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(r),
      }),
    );
    expect(post.status).toBe(200);
    // Now query with the devnet key — should see nothing.
    const list = await authedFetch(rig, `/v1/receipts/${AGENT_B}`);
    const body = (await list.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });
});

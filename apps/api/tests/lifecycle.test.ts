import { describe, it, expect } from 'vitest';

import { createTestRig, authedFetch } from './helpers.js';

const DUMMY_AGENT_MINT = 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp';
const DUMMY_PAYER = '6vWQv7PYYJ43uM3yHrUrLoXkWE3TUkHRMyYstUjt8gnj';
const DUMMY_EXECUTIVE = '8x7nQv2C8j7e6jK6YwCmcEHEFDxFR6PAYgFdLP6L4tPP';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/**
 * These tests exercise the full prepare lifecycle without ever leaving
 * the API process: zod validation, API key auth + network binding,
 * Umi-backed builder construction, base64 wire serialisation, and the
 * resulting Turso row state. They go to the public devnet for blockhash
 * + RPC reads; if devnet is unreachable the test fails loudly rather
 * than silently passing.
 */
describe('prepare → events lifecycle', () => {
  it('prepareSetSpendDelegation returns wire transaction + creates event row', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, `/v1/agents/${DUMMY_AGENT_MINT}/delegation/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payer: DUMMY_PAYER,
        spl_mint: USDC_DEVNET,
        executive: DUMMY_EXECUTIVE,
        amount: '1000000',
        client_reference: 'order-42',
      }),
    });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`prepare failed (${res.status}): ${text}`);
    }
    const body = (await res.json()) as {
      event_id: string;
      network: string;
      transaction: { base64: string; message_base64: string; fee_payer: string };
      echo: {
        treasury: string;
        source_token_account: string;
        delegated_amount: string;
        delegate: string;
        will_create_ata: boolean;
      };
    };
    expect(body.event_id).toMatch(/^[0-9A-Z]{20,}$/);
    expect(body.network).toBe('solana-devnet');
    expect(body.transaction.base64.length).toBeGreaterThan(0);
    expect(body.transaction.message_base64.length).toBeGreaterThan(0);
    expect(body.transaction.fee_payer).toBe(DUMMY_PAYER);
    expect(body.echo.delegated_amount).toBe('1000000');
    expect(body.echo.delegate).toBe(DUMMY_EXECUTIVE);

    // Event row should be visible via the API at `phase=prepared`.
    const eventRes = await authedFetch(rig, `/v1/events/${body.event_id}`);
    expect(eventRes.status).toBe(200);
    const ev = (await eventRes.json()) as {
      phase: string;
      kind: string;
      network: string;
      amount_atomic: string | null;
      client_reference: string | null;
      agent_asset: string | null;
    };
    expect(ev.phase).toBe('prepared');
    expect(ev.kind).toBe('agent.delegation.set');
    expect(ev.network).toBe('solana-devnet');
    expect(ev.amount_atomic).toBe('1000000');
    expect(ev.client_reference).toBe('order-42');
    expect(ev.agent_asset).toBe(DUMMY_AGENT_MINT);
  }, 30_000);

  it('pad_for_protocol_fee gross-ups the SPL Approve by 1% (default bps)', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, `/v1/agents/${DUMMY_AGENT_MINT}/delegation/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payer: DUMMY_PAYER,
        spl_mint: USDC_DEVNET,
        executive: DUMMY_EXECUTIVE,
        amount: '1000000',
        pad_for_protocol_fee: true,
      }),
    });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`prepare failed (${res.status}): ${text}`);
    }
    const body = (await res.json()) as {
      echo: { delegated_amount: string; fee_padding_atoms: string };
      // amount_atomic on the event row mirrors `delegated_amount` so
      // accounting / metering reports the gross figure too.
    };
    expect(body.echo.delegated_amount).toBe('1010000');
    expect(body.echo.fee_padding_atoms).toBe('10000');
  }, 30_000);

  it('omitting pad_for_protocol_fee leaves the request amount intact', async () => {
    const rig = await createTestRig();
    const res = await authedFetch(rig, `/v1/agents/${DUMMY_AGENT_MINT}/delegation/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payer: DUMMY_PAYER,
        spl_mint: USDC_DEVNET,
        executive: DUMMY_EXECUTIVE,
        amount: '1000000',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      echo: { delegated_amount: string; fee_padding_atoms: string };
    };
    expect(body.echo.delegated_amount).toBe('1000000');
    expect(body.echo.fee_padding_atoms).toBe('0');
  }, 30_000);

  it('rejects mainnet event lookups with a devnet key', async () => {
    const rig = await createTestRig();
    // Create an event row directly in the DB on mainnet.
    const { createPreparedEvent } = await import('../src/storage/events.js');
    const id = await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-mainnet',
    });
    const res = await authedFetch(rig, `/v1/events/${id}`);
    expect(res.status).toBe(404);
  });

  it("lists events for the caller's network only", async () => {
    const rig = await createTestRig();
    const { createPreparedEvent } = await import('../src/storage/events.js');
    await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-devnet',
    });
    await createPreparedEvent(rig.db, {
      kind: 'agent.identity.register',
      network: 'solana-mainnet',
    });
    const res = await authedFetch(rig, '/v1/events');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ network: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    for (const it of body.items) expect(it.network).toBe('solana-devnet');
  });
});

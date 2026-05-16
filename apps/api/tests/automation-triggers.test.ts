import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAutomation, listAutomationRunsForOwner } from '../src/storage/automations.js';
import { signPayload } from '../src/webhooks/sign.js';
import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'b'.repeat(64);
const PRIVY_ID = 'did:privy:auto-triggers';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';
const TREASURY = 'FZQ4SyEUxGRgTwT7DvKi8b8tqezZbTnpVvPm9wgL2Lz3';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function authHeaders() {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ADMIN_SECRET}`,
  };
}

async function seedAgent(rig: Awaited<ReturnType<typeof createTestRig>>) {
  await rig.db.execute({
    sql: 'INSERT INTO platform_users (privy_id, wallet, email) VALUES (?, ?, ?)',
    args: [PRIVY_ID, WALLET, null],
  });
  const res = await rig.app.fetch(
    new Request('http://test.local/v1/platform/agents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        mint: MINT,
        treasury: TREASURY,
        owner_privy_id: PRIVY_ID,
        owner_wallet: WALLET,
        name: 'Automation Agent',
        network: 'solana-devnet',
        model: 'claude-3-5-sonnet',
        system_prompt: 's',
        capabilities: [],
        budget: { per_action: '0.10', per_task: '1.00', per_day: '10.00' },
        llm_provider: 'anthropic',
        llm_api_key: 'sk-ant-x',
      }),
    }),
  );
  expect(res.status).toBe(200);
}

function stubAgentsBff() {
  const realFetch = globalThis.fetch.bind(globalThis);
  const calls: unknown[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.includes('agents-bff.test')) {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          text: 'Triggered run complete.',
          artifacts: [],
          errors: [],
          warnings: [],
          model: 'claude-test',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input as Parameters<typeof realFetch>[0], init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

describe('automation webhook triggers', () => {
  it('verifies signatures, executes once, and dedupes retries', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const automation = await createAutomation(rig.db, {
      ownerPrivyId: PRIVY_ID,
      agentMint: MINT,
      name: 'Webhook run',
      instructions: 'Handle the inbound webhook payload.',
      status: 'enabled',
      triggerType: 'webhook',
      triggerConfig: { label: 'Inbound webhook', signature_required: true, secret: 'whsec_test' },
      sourceConfig: { toolkit_slugs: ['github'] },
      deliveryPolicy: 'history_only',
    });
    const { calls } = stubAgentsBff();
    const raw = JSON.stringify({ event_id: 'evt_1', message: 'hello' });
    const signature = signPayload('whsec_test', raw).header;

    const first = await rig.app.fetch(
      new Request(`http://test.local/v1/automation-hooks/${automation.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-leash-signature': signature,
          'idempotency-key': 'evt_1',
        },
        body: raw,
      }),
    );
    expect(first.status).toBe(200);
    expect((await first.json()) as { status: string; duplicate: boolean }).toMatchObject({
      status: 'succeeded',
      duplicate: false,
    });

    const retry = await rig.app.fetch(
      new Request(`http://test.local/v1/automation-hooks/${automation.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-leash-signature': signature,
          'idempotency-key': 'evt_1',
        },
        body: raw,
      }),
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()) as { status: string; duplicate: boolean }).toMatchObject({
      status: 'succeeded',
      duplicate: true,
    });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { trigger_type: string; source_config: unknown }).trigger_type).toBe(
      'webhook',
    );

    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs).toHaveLength(1);
  });

  it('rejects invalid webhook signatures before executing', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const automation = await createAutomation(rig.db, {
      ownerPrivyId: PRIVY_ID,
      agentMint: MINT,
      name: 'Webhook run',
      instructions: 'Handle the inbound webhook payload.',
      status: 'enabled',
      triggerType: 'webhook',
      triggerConfig: { signature_required: true, secret: 'whsec_test' },
      deliveryPolicy: 'history_only',
    });
    const { calls } = stubAgentsBff();

    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/automation-hooks/${automation.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-leash-signature': 'bad' },
        body: JSON.stringify({ event_id: 'evt_bad' }),
      }),
    );
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('automation event triggers', () => {
  it('fires enabled event automations and dedupes repeated event ids', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const automation = await createAutomation(rig.db, {
      ownerPrivyId: PRIVY_ID,
      agentMint: MINT,
      name: 'Receipt watcher',
      instructions: 'Summarize the settled receipt.',
      status: 'enabled',
      triggerType: 'event',
      triggerConfig: { event: 'receipt.settled' },
      sourceConfig: {},
      deliveryPolicy: 'history_only',
    });
    const { calls } = stubAgentsBff();

    const fire = async () =>
      rig.app.fetch(
        new Request('http://test.local/v1/platform/automations/events', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            owner_privy_id: PRIVY_ID,
            event: 'receipt.settled',
            payload: { receipt_hash: 'abc' },
            idempotency_key: 'receipt:abc',
          }),
        }),
      );

    const first = await fire();
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { items: Array<{ duplicate: boolean }> };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]!.duplicate).toBe(false);

    const second = await fire();
    const secondBody = (await second.json()) as { items: Array<{ duplicate: boolean }> };
    expect(secondBody.items[0]!.duplicate).toBe(true);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { trigger_type: string }).trigger_type).toBe('event');

    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs).toHaveLength(1);
  });
});

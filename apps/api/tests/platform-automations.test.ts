import { beforeAll, describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'b'.repeat(64);
const PRIVY_ID = 'did:privy:auto-owner';
const OTHER_PRIVY_ID = 'did:privy:other-owner';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';
const TREASURY = 'FZQ4SyEUxGRgTwT7DvKi8b8tqezZbTnpVvPm9wgL2Lz3';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
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

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    owner_privy_id: PRIVY_ID,
    agent_mint: MINT,
    name: 'Morning operator brief',
    description: 'Summarize connected inboxes before standup.',
    instructions: 'Check the connected inboxes and write a concise operator brief.',
    status: 'paused',
    trigger_type: 'schedule',
    trigger_config: { schedule: 'daily', time: '09:00' },
    source_config: { connection_ids: ['gmail-1'], toolkit_slugs: ['gmail'] },
    delivery_policy: 'history_only',
    delivery_config: {},
    budget_per_run: '0.25',
    budget_per_day: '2',
    timezone: 'Africa/Lagos',
    ...overrides,
  };
}

describe('platform automation endpoints', () => {
  it('creates, lists, patches, and soft-deletes automations for an owner', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);

    const create = await rig.app.fetch(
      new Request('http://test.local/v1/platform/automations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(createBody()),
      }),
    );
    expect(create.status).toBe(200);
    const automation = (await create.json()) as {
      id: string;
      name: string;
      instructions: string;
      trigger_type: string;
      source_config: { toolkit_slugs?: string[] };
    };
    expect(automation.name).toBe('Morning operator brief');
    expect(automation.instructions).toBe(
      'Check the connected inboxes and write a concise operator brief.',
    );
    expect(automation.trigger_type).toBe('schedule');
    expect(automation.source_config.toolkit_slugs).toEqual(['gmail']);

    const list = await rig.app.fetch(
      new Request(
        `http://test.local/v1/platform/automations?owner_privy_id=${encodeURIComponent(PRIVY_ID)}`,
        { headers: authHeaders() },
      ),
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { items: Array<{ id: string }> };
    expect(listed.items.map((i) => i.id)).toEqual([automation.id]);

    const patch = await rig.app.fetch(
      new Request(
        `http://test.local/v1/platform/automations/${automation.id}?owner_privy_id=${encodeURIComponent(PRIVY_ID)}`,
        {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({
            status: 'enabled',
            delivery_policy: 'on_failure',
            budget_per_run: '0.50',
            instructions: 'Only report items that need direct operator action.',
          }),
        },
      ),
    );
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as {
      status: string;
      delivery_policy: string;
      instructions: string;
    };
    expect(patched.status).toBe('enabled');
    expect(patched.delivery_policy).toBe('on_failure');
    expect(patched.instructions).toBe('Only report items that need direct operator action.');

    const del = await rig.app.fetch(
      new Request(
        `http://test.local/v1/platform/automations/${automation.id}?owner_privy_id=${encodeURIComponent(PRIVY_ID)}`,
        { method: 'DELETE', headers: authHeaders() },
      ),
    );
    expect(del.status).toBe(200);

    const afterDelete = await rig.app.fetch(
      new Request(
        `http://test.local/v1/platform/automations?owner_privy_id=${encodeURIComponent(PRIVY_ID)}`,
        { headers: authHeaders() },
      ),
    );
    const afterBody = (await afterDelete.json()) as { items: unknown[] };
    expect(afterBody.items).toHaveLength(0);
  });

  it('rejects automation creation for another owner agent', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);

    const res = await rig.app.fetch(
      new Request('http://test.local/v1/platform/automations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(createBody({ owner_privy_id: OTHER_PRIVY_ID })),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects invalid budgets', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);

    const res = await rig.app.fetch(
      new Request('http://test.local/v1/platform/automations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(createBody({ budget_per_run: '-1' })),
      }),
    );
    expect(res.status).toBe(422);
  });

  it('lists run history rows for owned automations', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);
    const create = await rig.app.fetch(
      new Request('http://test.local/v1/platform/automations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(createBody()),
      }),
    );
    const automation = (await create.json()) as { id: string };
    await rig.db.execute({
      sql: `INSERT INTO automation_runs (
        id, automation_id, owner_privy_id, agent_mint, trigger_type,
        trigger_payload, status, output_text, spend_usd, receipts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'run_1',
        automation.id,
        PRIVY_ID,
        MINT,
        'schedule',
        JSON.stringify({ fired_at: '2026-05-16T09:00:00.000Z' }),
        'succeeded',
        'Brief complete.',
        '0.05',
        JSON.stringify([{ receipt_hash: 'abc' }]),
      ],
    });

    const runs = await rig.app.fetch(
      new Request(
        `http://test.local/v1/platform/automations/${automation.id}/runs?owner_privy_id=${encodeURIComponent(PRIVY_ID)}`,
        { headers: authHeaders() },
      ),
    );
    expect(runs.status).toBe(200);
    const body = (await runs.json()) as {
      items: Array<{ id: string; output_text: string; receipts: unknown[] }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.output_text).toBe('Brief complete.');
    expect(body.items[0]!.receipts).toHaveLength(1);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';
import { listTaskActivities, recordTaskActivity } from '../src/storage/platform-tasks.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'a'.repeat(64);
const PRIVY_ID = 'did:privy:t1';
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
        name: 'Demo',
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

describe('platform task endpoints', () => {
  it('rejects without admin secret', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const r = await rig.app.fetch(
      new Request('http://test.local/v1/platform/tasks', { method: 'POST' }),
    );
    expect(r.status).toBe(401);
  });

  it('rejects task creation for unknown agent', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const r = await rig.app.fetch(
      new Request('http://test.local/v1/platform/tasks', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ agent_mint: MINT, prompt: 'hi', budget_cap: '1.00' }),
      }),
    );
    expect(r.status).toBe(404);
  });

  it('enqueues, lists, fetches, and shows activities for a task', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);

    const create = await rig.app.fetch(
      new Request('http://test.local/v1/platform/tasks', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ agent_mint: MINT, prompt: 'do thing', budget_cap: '2.50' }),
      }),
    );
    expect(create.status).toBe(200);
    const task = (await create.json()) as {
      id: string;
      agent_mint: string;
      status: string;
      budget_cap: string;
    };
    expect(task.status).toBe('pending');
    expect(task.budget_cap).toBe('2.50');

    const list = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/tasks?agent_mint=${MINT}`, {
        headers: authHeaders(),
      }),
    );
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: Array<{ id: string }> }).items;
    expect(items.map((i) => i.id)).toEqual([task.id]);

    const single = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/tasks/${task.id}`, { headers: authHeaders() }),
    );
    expect(single.status).toBe(200);

    // Direct write of activity rows then read back via the route.
    await recordTaskActivity(rig.db, {
      taskId: task.id,
      type: 'think',
      payload: { text: 'considering options' },
    });
    await recordTaskActivity(rig.db, {
      taskId: task.id,
      type: 'tool_call',
      payload: { name: 'web_search', args: { query: 'usdc' } },
    });

    const acts = await listTaskActivities(rig.db, task.id);
    expect(acts).toHaveLength(2);

    const actsRoute = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/tasks/${task.id}/activities`, {
        headers: authHeaders(),
      }),
    );
    expect(actsRoute.status).toBe(200);
    const actsBody = (await actsRoute.json()) as { items: Array<{ type: string }> };
    expect(actsBody.items.map((a) => a.type)).toEqual(['think', 'tool_call']);
  });

  it('rejects invalid budget_cap', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);
    const r = await rig.app.fetch(
      new Request('http://test.local/v1/platform/tasks', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ agent_mint: MINT, prompt: 'do thing', budget_cap: '0' }),
      }),
    );
    expect(r.status).toBe(422);
  });
});

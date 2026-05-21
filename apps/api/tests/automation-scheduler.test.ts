import { beforeAll, describe, expect, it, vi } from 'vitest';

import { computeNextRunAt } from '../src/automations/schedule.js';
import { runAutomationSchedulerOnce } from '../src/automations/runner.js';
import {
  createAutomation,
  getAutomationById,
  listAutomationRunsForOwner,
} from '../src/storage/automations.js';
import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'b'.repeat(64);
const PRIVY_ID = 'did:privy:auto-scheduler';
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

async function seedDueAutomation(rig: Awaited<ReturnType<typeof createTestRig>>) {
  return createAutomation(rig.db, {
    ownerPrivyId: PRIVY_ID,
    agentMint: MINT,
    name: 'Morning operator brief',
    description: 'Summarize connected sources.',
    instructions: 'Write the brief and flag anything that needs attention.',
    status: 'enabled',
    triggerType: 'schedule',
    triggerConfig: { schedule: 'daily', time: '09:00' },
    sourceConfig: { toolkit_slugs: ['gmail', 'slack'] },
    deliveryPolicy: 'history_only',
    timezone: 'Africa/Lagos',
    nextRunAt: '2026-05-16T07:59:00.000Z',
  });
}

describe('automation schedule calculation', () => {
  it('computes timezone-aware daily, weekly, and interval next runs', () => {
    expect(
      computeNextRunAt(
        {
          triggerType: 'schedule',
          triggerConfig: { schedule: 'daily', time: '09:00' },
          timezone: 'Africa/Lagos',
        },
        new Date('2026-05-16T07:30:00.000Z'),
      ),
    ).toBe('2026-05-16T08:00:00.000Z');

    expect(
      computeNextRunAt(
        {
          triggerType: 'schedule',
          triggerConfig: { schedule: 'daily', time: '09:00' },
          timezone: 'Africa/Lagos',
        },
        new Date('2026-05-16T08:30:00.000Z'),
      ),
    ).toBe('2026-05-17T08:00:00.000Z');

    expect(
      computeNextRunAt(
        {
          triggerType: 'schedule',
          triggerConfig: { schedule: 'weekly', weekday: 1, time: '09:00' },
          timezone: 'Africa/Lagos',
        },
        new Date('2026-05-16T08:30:00.000Z'),
      ),
    ).toBe('2026-05-18T08:00:00.000Z');

    expect(
      computeNextRunAt(
        {
          triggerType: 'schedule',
          triggerConfig: { schedule: 'interval', interval_minutes: 45 },
          timezone: 'UTC',
        },
        new Date('2026-05-16T08:30:00.000Z'),
      ),
    ).toBe('2026-05-16T09:15:00.000Z');
  });
});

describe('automation scheduler runner', () => {
  it('claims one due automation, invokes the agents BFF, and records success', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const automation = await seedDueAutomation(rig);

    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        automation_id: string;
        instructions: string;
        source_config: { toolkit_slugs?: string[] };
      };
      expect(body.automation_id).toBe(automation.id);
      expect(body.instructions).toContain('Write the brief');
      expect(body.source_config.toolkit_slugs).toEqual(['gmail', 'slack']);
      return new Response(
        JSON.stringify({
          text: 'Brief complete.',
          artifacts: [{ kind: 'receipt', payload: { receipt_hash: 'abc' } }],
          errors: [],
          warnings: ['minor'],
          model: 'claude-test',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      fetchImpl: fetchImpl as typeof fetch,
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
    });

    expect(result.status).toBe('succeeded');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const updated = await getAutomationById(rig.db, automation.id);
    expect(updated?.lockedBy).toBeNull();
    expect(updated?.lastStatus).toBe('succeeded');
    expect(updated?.nextRunAt).not.toBeNull();

    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
    expect(runs[0]!.outputText).toBe('Brief complete.');
    expect(runs[0]!.receipts).toHaveLength(1);
  });

  it('records a failed run when the agents BFF is not configured', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);
    const automation = await seedDueAutomation(rig);

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('agents BFF is not configured');
    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.error).toContain('agents BFF is not configured');
  });
});

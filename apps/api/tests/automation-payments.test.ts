import { beforeAll, describe, expect, it, vi } from 'vitest';

import { runAutomationSchedulerOnce } from '../src/automations/runner.js';
import { createAutomation, listAutomationRunsForOwner } from '../src/storage/automations.js';
import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'b'.repeat(64);
const PRIVY_ID = 'did:privy:auto-payments';
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

async function seedAutomation(rig: Awaited<ReturnType<typeof createTestRig>>, perRun = '0.25') {
  return createAutomation(rig.db, {
    ownerPrivyId: PRIVY_ID,
    agentMint: MINT,
    name: 'Payment automation',
    instructions: 'Use a paid data source if needed.',
    status: 'enabled',
    triggerType: 'schedule',
    triggerConfig: { schedule: 'daily', time: '09:00' },
    deliveryPolicy: 'history_only',
    budgetPerRun: perRun,
    budgetPerDay: '2',
    timezone: 'Africa/Lagos',
    nextRunAt: '2026-05-16T07:59:00.000Z',
  });
}

function paymentBff(amountAtomic: string) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          text: 'Need paid data.',
          artifacts: [
            {
              kind: 'payment_request',
              payload: {
                url: 'https://seller.test/x/1',
                preview: { amount_atomic: amountAtomic, currency: 'USDC' },
              },
            },
          ],
          errors: [],
          warnings: [],
          model: 'claude-test',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
}

describe('automation payment controls', () => {
  it('blocks payment requests above the per-run cap', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const automation = await seedAutomation(rig, '0.25');

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      fetchImpl: paymentBff('1000000') as typeof fetch,
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('above the per-run cap');
    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs[0]!.spendUsd).toBe('0');
    expect(runs[0]!.sourceSummary.payment).toMatchObject({ status: 'blocked' });
  });

  it('records under-cap payment requests as requiring approval', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const automation = await seedAutomation(rig, '0.25');

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      fetchImpl: paymentBff('100000') as typeof fetch,
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
    });

    expect(result.status).toBe('succeeded');
    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs[0]!.outputText).toContain('require approval before settlement');
    expect(runs[0]!.sourceSummary.payment).toMatchObject({
      status: 'requires_approval',
      totalUsd: 0.1,
    });
  });
});

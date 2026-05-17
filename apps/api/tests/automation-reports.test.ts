import { beforeAll, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@leashmarket/platform-auth/encryption';

import { runAutomationSchedulerOnce } from '../src/automations/runner.js';
import {
  createAutomation,
  listAutomationRunsForOwner,
  pruneExpiredAutomationRuns,
} from '../src/storage/automations.js';
import {
  bindExternalConnection,
  createExternalConnection,
} from '../src/storage/external-connections.js';
import type { TelegramClient } from '../src/external/telegram-client.js';
import { verifySignature } from '../src/webhooks/sign.js';
import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'b'.repeat(64);
const PRIVY_ID = 'did:privy:auto-reports';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';
const TREASURY = 'FZQ4SyEUxGRgTwT7DvKi8b8tqezZbTnpVvPm9wgL2Lz3';
const BOT_TOKEN = '123456789:ABCdef-ghi_jklmnopqrstuvwxyz12345678';

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

async function seedScheduledAutomation(
  rig: Awaited<ReturnType<typeof createTestRig>>,
  overrides: Parameters<typeof createAutomation>[1] extends infer T ? Partial<T> : never = {},
) {
  return createAutomation(rig.db, {
    ownerPrivyId: PRIVY_ID,
    agentMint: MINT,
    name: 'Report automation',
    instructions: 'Run and report.',
    status: 'enabled',
    triggerType: 'schedule',
    triggerConfig: { schedule: 'daily', time: '09:00' },
    deliveryPolicy: 'history_only',
    timezone: 'Africa/Lagos',
    nextRunAt: '2026-05-16T07:59:00.000Z',
    ...overrides,
  });
}

describe('automation report delivery', () => {
  it('POSTs a signed report when delivery applies', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const automation = await seedScheduledAutomation(rig, {
      deliveryPolicy: 'every_run',
      deliveryConfig: { webhook_url: 'https://reports.test/hook', secret: 'report_secret' },
    });
    const reportCalls: Array<{ sig: string; body: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.includes('agents-bff.test')) {
        return new Response(
          JSON.stringify({
            text: 'Reportable output.',
            artifacts: [],
            errors: [],
            warnings: [],
            model: 'claude-test',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href === 'https://reports.test/hook') {
        const headers = new Headers(init?.headers);
        reportCalls.push({
          sig: headers.get('x-leash-signature') ?? '',
          body: String(init?.body ?? ''),
        });
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      fetchImpl: fetchImpl as typeof fetch,
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
    });

    expect(result.status).toBe('succeeded');
    expect(reportCalls).toHaveLength(1);
    expect(verifySignature('report_secret', reportCalls[0]!.body, reportCalls[0]!.sig)).toBe(true);
    const report = JSON.parse(reportCalls[0]!.body) as {
      automation_id: string;
      output_text: string;
    };
    expect(report.automation_id).toBe(automation.id);
    expect(report.output_text).toBe('Reportable output.');

    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs[0]!.deliveryStatus).toBe('delivered');
    expect(runs[0]!.deliveryResult.response_status).toBe(204);
  });

  it('records no_destination for failure reports without a destination', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);
    const automation = await seedScheduledAutomation(rig, { deliveryPolicy: 'on_failure' });

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
    });

    expect(result.status).toBe('failed');
    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs[0]!.deliveryStatus).toBe('no_destination');
    expect(runs[0]!.deliveryResult.policy).toBe('on_failure');
  });

  it('delivers automation reports to the configured Telegram chat', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      encryptionKey: ENC_KEY,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const conn = await createExternalConnection(rig.db, {
      ownerPrivyId: PRIVY_ID,
      channel: 'telegram',
      displayName: 'Telegram',
      encryptedCredential: encryptSecret(BOT_TOKEN, ENC_KEY),
      routingId: 'telegram-route',
      botUsername: 'leash_bot',
    });
    await bindExternalConnection(rig.db, { id: conn.id, boundChatId: 'chat-123' });
    const automation = await seedScheduledAutomation(rig, {
      deliveryPolicy: 'every_run',
      deliveryConfig: { kind: 'external_chat', connection_id: conn.id, channel: 'telegram' },
    });
    const sent: Array<{ chatId: string; text: string }> = [];
    const telegram: TelegramClient = {
      async sendMessage(args) {
        sent.push({ chatId: args.chatId, text: args.text });
        return { ok: true, status: 200, body: '{"ok":true}' };
      },
      async getMe() {
        return { id: 1, is_bot: true, username: 'leash_bot' };
      },
    };
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          text: 'Report sent to chat.',
          artifacts: [],
          errors: [],
          warnings: [],
          model: 'claude-test',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      fetchImpl: fetchImpl as typeof fetch,
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
      reportDelivery: {
        config: rig.config,
        db: rig.db,
        telegramClientFactory: () => telegram,
      },
    });

    expect(result.status).toBe('succeeded');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe('chat-123');
    expect(sent[0]!.text).toContain('Automation report');
    expect(sent[0]!.text).toContain('Report sent to chat.');
    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs[0]!.deliveryStatus).toBe('delivered');
    expect(runs[0]!.deliveryResult.kind).toBe('external_chat');
  });

  it('records failed delivery when a WhatsApp report target has no live manager', async () => {
    const rig = await createTestRig({
      adminSecret: ADMIN_SECRET,
      agentsBffUrl: 'http://agents-bff.test',
      agentsBffSecret: 'secret'.repeat(8),
    });
    await seedAgent(rig);
    const conn = await createExternalConnection(rig.db, {
      ownerPrivyId: PRIVY_ID,
      channel: 'whatsapp',
      displayName: 'WhatsApp',
    });
    await bindExternalConnection(rig.db, { id: conn.id, boundChatId: '15551234567' });
    const automation = await seedScheduledAutomation(rig, {
      deliveryPolicy: 'every_run',
      deliveryConfig: { kind: 'external_chat', connection_id: conn.id, channel: 'whatsapp' },
    });
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          text: 'WhatsApp report body.',
          artifacts: [],
          errors: [],
          warnings: [],
          model: 'claude-test',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runAutomationSchedulerOnce(rig.db, rig.config, {
      fetchImpl: fetchImpl as typeof fetch,
      now: new Date('2026-05-16T08:00:00.000Z'),
      workerId: 'worker-a',
      reportDelivery: { config: rig.config, db: rig.db },
    });

    expect(result.status).toBe('succeeded');
    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs[0]!.deliveryStatus).toBe('failed');
    expect(runs[0]!.deliveryResult.error).toBe('whatsapp_unavailable');
  });

  it('prunes run history past each automation retention window', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await seedAgent(rig);
    const automation = await seedScheduledAutomation(rig, {
      status: 'paused',
      retentionDays: 1,
    });
    await rig.db.execute({
      sql: `INSERT INTO automation_runs (
        id, automation_id, owner_privy_id, agent_mint, trigger_type,
        trigger_payload, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'old_run',
        automation.id,
        PRIVY_ID,
        MINT,
        'schedule',
        '{}',
        'succeeded',
        '2026-05-14T08:00:00.000Z',
        'new_run',
        automation.id,
        PRIVY_ID,
        MINT,
        'schedule',
        '{}',
        'succeeded',
        '2026-05-16T07:00:00.000Z',
      ],
    });

    const result = await pruneExpiredAutomationRuns(rig.db, new Date('2026-05-16T08:00:00.000Z'));
    expect(result.deleted).toBe(1);
    const runs = await listAutomationRunsForOwner(rig.db, PRIVY_ID, automation.id);
    expect(runs.map((r) => r.id)).toEqual(['new_run']);
  });
});

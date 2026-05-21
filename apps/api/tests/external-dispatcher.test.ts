/**
 * Phase 3 dispatcher coverage. We:
 *
 *  - Stub the apps/agents BFF fetch so the test never spawns the
 *    Claude Agent SDK or talks to Anthropic.
 *  - Stub the Telegram client factory so we observe the outbound
 *    `sendMessage` payload without hitting api.telegram.org.
 *  - Drive the webhook end-to-end via `app.fetch` so the route layer,
 *    audit ledger, approval token mint, and reply formatting are all
 *    exercised in the same flow.
 *
 * `LEASH_API_AWAIT_DISPATCH=1` makes the route handler await the
 * dispatcher's promise, so test assertions can observe the outbound
 * side-effects synchronously. In production we never set that flag —
 * the webhook returns 200 to Telegram immediately and the dispatcher
 * runs after.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';
import type { TelegramClient } from '../src/external/telegram-client.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'a'.repeat(64);
const PRIVY_ID = 'did:privy:demo';
const BOT_TOKEN = '123456789:ABCdef-ghi_jklmnopqrstuvwxyz12345678';
const BOT_USERNAME = 'leash_test_bot';
const TELEGRAM_FROM_ID = '999111222';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
  process.env.LEASH_API_AWAIT_DISPATCH = '1';
});
afterAll(() => {
  delete process.env.LEASH_API_AWAIT_DISPATCH;
});

type Sent = {
  chatId: string;
  text: string;
  parseMode?: string;
};

function makeStubTelegram(): {
  client: TelegramClient;
  factory: (token: string) => TelegramClient;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const client: TelegramClient = {
    async sendMessage(args) {
      sent.push({
        chatId: args.chatId,
        text: args.text,
        ...(args.parseMode ? { parseMode: args.parseMode } : {}),
      });
      return { ok: true, status: 200, body: '{"ok":true}' };
    },
    async getMe() {
      return { id: 1, is_bot: true, username: BOT_USERNAME };
    },
  };
  return { client, factory: () => client, sent };
}

function makeStubBffFetch(responder: (body: Record<string, unknown>) => unknown): {
  fetcher: typeof fetch;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.includes('/api/agents/run')) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push(body);
      const result = responder(body);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not stubbed', { status: 500 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

async function bootRig(args: {
  bffFetch: typeof fetch;
  telegramFactory: (token: string) => TelegramClient;
}) {
  return createTestRig({
    adminSecret: ADMIN_SECRET,
    encryptionKey: ENC_KEY,
    agentsBffUrl: 'http://agents-bff.test.invalid',
    agentsBffSecret: 'b'.repeat(48),
    externalDispatcherBffFetch: args.bffFetch,
    externalDispatcherTelegramClientFactory: args.telegramFactory,
  });
}

async function provisionAndBind(rig: Awaited<ReturnType<typeof createTestRig>>) {
  const create = await rig.app.fetch(
    new Request('http://test.local/v1/external/connections', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ADMIN_SECRET}`,
      },
      body: JSON.stringify({
        owner_privy_id: PRIVY_ID,
        channel: 'telegram',
        display_name: 'My Telegram',
        bot_token: BOT_TOKEN,
        bot_username: BOT_USERNAME,
      }),
    }),
  );
  const created = (await create.json()) as {
    connection: { id: string; routing_id: string; verification_token: string };
  };
  const bind = await rig.app.fetch(
    new Request(`http://test.local/v1/external/telegram/webhook/${created.connection.routing_id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          from: { id: TELEGRAM_FROM_ID },
          text: `/start ${created.connection.verification_token}`,
        },
      }),
    }),
  );
  expect(bind.status).toBe(200);
  return created.connection;
}

describe('telegram dispatcher — phase 3 happy paths', () => {
  it('runs a read-tool turn and replies with the assistant text via sendMessage', async () => {
    const tg = makeStubTelegram();
    const bff = makeStubBffFetch((body) => {
      expect(body.owner_privy_id).toBe(PRIVY_ID);
      expect(body.channel).toBe('telegram');
      expect(body.message).toBe('show last receipt');
      return {
        text: 'Your last receipt was 0xabc on devnet.',
        artifacts: [],
        errors: [],
        agent_mint: MINT,
      };
    });
    const rig = await bootRig({ bffFetch: bff.fetcher, telegramFactory: tg.factory });
    const conn = await provisionAndBind(rig);

    const inbound = await rig.app.fetch(
      new Request(`http://test.local/v1/external/telegram/webhook/${conn.routing_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { from: { id: TELEGRAM_FROM_ID }, text: 'show last receipt' },
        }),
      }),
    );
    expect(inbound.status).toBe(200);
    expect(bff.calls).toHaveLength(1);
    expect(bff.calls[0]!.external_connection_id).toBe(conn.id);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]!.chatId).toBe(TELEGRAM_FROM_ID);
    expect(tg.sent[0]!.parseMode).toBe('MarkdownV2');
    // The text should be MarkdownV2-escaped: "0xabc" → "0xabc" (safe),
    // but the trailing period MUST be backslash-escaped.
    expect(tg.sent[0]!.text).toContain('\\.');
    expect(tg.sent[0]!.text).toContain('Your last receipt');
  });

  it('mints an approval token for a withdraw artifact and embeds the deep link', async () => {
    const tg = makeStubTelegram();
    const bff = makeStubBffFetch(() => ({
      text: 'Review the withdraw card below.',
      artifacts: [
        {
          kind: 'withdraw_request',
          payload: {
            agent_mint: MINT,
            token: 'USDC',
            amount: '5.00',
            destination: 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd',
            network: 'solana-devnet',
          },
        },
      ],
      errors: [],
      agent_mint: MINT,
    }));
    const rig = await bootRig({ bffFetch: bff.fetcher, telegramFactory: tg.factory });
    const conn = await provisionAndBind(rig);

    await rig.app.fetch(
      new Request(`http://test.local/v1/external/telegram/webhook/${conn.routing_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            from: { id: TELEGRAM_FROM_ID },
            text: 'withdraw 5 usdc to FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd',
          },
        }),
      }),
    );

    expect(tg.sent).toHaveLength(1);
    const reply = tg.sent[0]!.text;
    expect(reply).toContain('Withdraw');
    // The reply should contain a Markdown link to /approve/<token> on
    // the agents app's public origin (defaults to LEASH_AGENTS_BFF_URL origin).
    expect(reply).toMatch(/\(http:\/\/agents-bff\.test\.invalid\/approve\//);

    // An approvals row should now exist for this connection.
    const rows = await rig.db.execute({
      sql: 'SELECT token, tool_name FROM external_approvals WHERE connection_id = ?',
      args: [conn.id],
    });
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0]!.tool_name)).toBe('leash_withdraw_treasury');
  });

  it('falls back to plain text when MarkdownV2 send fails', async () => {
    const sent: Sent[] = [];
    let firstSend = true;
    const factory = (): TelegramClient => ({
      async sendMessage(args) {
        sent.push({
          chatId: args.chatId,
          text: args.text,
          ...(args.parseMode ? { parseMode: args.parseMode } : {}),
        });
        if (firstSend) {
          firstSend = false;
          return { ok: false, status: 400, body: '{"ok":false,"description":"Bad Request"}' };
        }
        return { ok: true, status: 200, body: '{"ok":true}' };
      },
      async getMe() {
        return { id: 1, is_bot: true, username: BOT_USERNAME };
      },
    });
    const bff = makeStubBffFetch(() => ({
      text: 'plain reply.',
      artifacts: [],
      errors: [],
      agent_mint: MINT,
    }));
    const rig = await bootRig({ bffFetch: bff.fetcher, telegramFactory: factory });
    const conn = await provisionAndBind(rig);

    await rig.app.fetch(
      new Request(`http://test.local/v1/external/telegram/webhook/${conn.routing_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { from: { id: TELEGRAM_FROM_ID }, text: 'hello' },
        }),
      }),
    );
    // Two sends: first MarkdownV2 fails with 400, second is plain text.
    expect(sent).toHaveLength(2);
    expect(sent[0]!.parseMode).toBe('MarkdownV2');
    expect(sent[1]!.parseMode).toBeUndefined();
  });

  it('returns a friendly error reply when the BFF is unreachable', async () => {
    const tg = makeStubTelegram();
    const fetcher = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const rig = await bootRig({ bffFetch: fetcher, telegramFactory: tg.factory });
    const conn = await provisionAndBind(rig);

    await rig.app.fetch(
      new Request(`http://test.local/v1/external/telegram/webhook/${conn.routing_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { from: { id: TELEGRAM_FROM_ID }, text: 'show receipts' },
        }),
      }),
    );
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]!.text).toContain('Couldn');
  });
});

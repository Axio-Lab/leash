import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  automationContextKey,
  createDbPendingStore,
  handleAutomationAssistantTurn,
  parseDraftFromPlannerText,
  type AutomationApi,
  type AutomationDraft,
  type AutomationWire,
} from '../lib/automations/assistant';

const OWNER = 'did:privy:user';
const AGENT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';

function automation(overrides: Partial<AutomationWire> = {}): AutomationWire {
  return {
    id: 'auto_1',
    owner_privy_id: OWNER,
    agent_mint: AGENT,
    name: 'Morning Gmail brief',
    description: 'Daily Gmail summary',
    instructions: 'Summarize Gmail every morning',
    status: 'enabled',
    trigger_type: 'schedule',
    trigger_config: { schedule: 'daily', time: '09:00' },
    source_config: { toolkit_slugs: ['gmail'] },
    delivery_policy: 'history_only',
    delivery_config: {},
    budget_per_run: '0.25',
    budget_per_day: '2',
    timezone: 'Africa/Lagos',
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    failure_count: 0,
    retention_days: 30,
    created_at: '2026-05-17T08:00:00.000Z',
    updated_at: '2026-05-17T08:00:00.000Z',
    ...overrides,
  };
}

function draft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    agent_mint: AGENT,
    name: 'Morning Gmail brief',
    description: 'Daily Gmail summary',
    instructions: 'Summarize Gmail every morning',
    status: 'enabled',
    trigger_type: 'schedule',
    trigger_config: { schedule: 'daily', time: '09:00' },
    source_config: { toolkit_slugs: ['gmail'] },
    delivery_policy: 'history_only',
    delivery_config: {},
    budget_per_run: '0.25',
    budget_per_day: '2',
    timezone: 'Africa/Lagos',
    retention_days: 30,
    ...overrides,
  };
}

function makeApi(initial: AutomationWire[] = []): {
  api: AutomationApi;
  created: AutomationDraft[];
  patched: Array<{ id: string; patch: Partial<AutomationDraft> }>;
  deleted: string[];
} {
  const rows = [...initial];
  const created: AutomationDraft[] = [];
  const patched: Array<{ id: string; patch: Partial<AutomationDraft> }> = [];
  const deleted: string[] = [];
  return {
    created,
    patched,
    deleted,
    api: {
      async listAutomations() {
        return rows;
      },
      async createAutomation(_owner, body) {
        created.push(body);
        const row = automation({
          id: `auto_${created.length}`,
          name: body.name,
          instructions: body.instructions,
          status: body.status,
          trigger_type: body.trigger_type,
          trigger_config: body.trigger_config,
          source_config: body.source_config,
          delivery_policy: body.delivery_policy,
          delivery_config: body.delivery_config,
        });
        rows.unshift(row);
        return row;
      },
      async patchAutomation(_owner, id, patch) {
        patched.push({ id, patch });
        const index = rows.findIndex((row) => row.id === id);
        const base = rows[index] ?? automation({ id });
        const updated = automation({
          ...base,
          status: patch.status ?? base.status,
          name: patch.name ?? base.name,
          budget_per_day: patch.budget_per_day ?? base.budget_per_day,
          budget_per_run: patch.budget_per_run ?? base.budget_per_run,
        });
        if (index >= 0) rows[index] = updated;
        return updated;
      },
      async deleteAutomation(_owner, id) {
        deleted.push(id);
      },
      async listRuns() {
        return [
          {
            id: 'run_1',
            automation_id: 'auto_1',
            status: 'succeeded',
            output_text: 'Gmail had three important messages.',
            error: null,
            delivery_status: 'history_only',
            spend_usd: '0',
            created_at: '2026-05-17T09:00:00.000Z',
            finished_at: '2026-05-17T09:00:02.000Z',
          },
        ];
      },
    },
  };
}

let db: ReturnType<typeof createClient>;

beforeEach(() => {
  db = createClient({ url: ':memory:' });
});

afterEach(() => {
  db.close();
});

describe('automation assistant core', () => {
  it('parses JSON-only draft output from the planner', () => {
    expect(
      parseDraftFromPlannerText(
        '```json\n{"name":"Brief","instructions":"Summarize Gmail","trigger_type":"schedule"}\n```',
      ),
    ).toMatchObject({
      name: 'Brief',
      instructions: 'Summarize Gmail',
      trigger_type: 'schedule',
    });
  });

  it('drafts a create action, stores it pending, and saves only after confirmation', async () => {
    const pending = createDbPendingStore(db);
    const { api, created } = makeApi();
    const planDraft = vi.fn(async () => draft());
    const contextKey = automationContextKey({ channel: 'web', ownerPrivyId: OWNER });

    const review = await handleAutomationAssistantTurn(
      { api, pending, planDraft },
      {
        ownerPrivyId: OWNER,
        message: 'Create an automation that summarizes Gmail every morning at 9am',
        agentMint: AGENT,
        channel: 'web',
        contextKey,
        timezone: 'Africa/Lagos',
        toolkits: [{ slug: 'gmail', name: 'Gmail' }],
        forceCreateOnUnknown: true,
      },
    );

    expect(review?.handled).toBe(true);
    expect(review?.text).toContain('Review this automation');
    expect(review?.pending_id).toBeTruthy();
    expect(created).toHaveLength(0);

    const saved = await handleAutomationAssistantTurn(
      { api, pending, planDraft },
      {
        ownerPrivyId: OWNER,
        message: 'confirm',
        agentMint: AGENT,
        channel: 'web',
        contextKey,
      },
    );

    expect(saved?.text).toContain('Saved automation');
    expect(created).toHaveLength(1);
  });

  it('lists automations and formats latest results', async () => {
    const pending = createDbPendingStore(db);
    const { api } = makeApi([automation()]);
    const deps = { api, pending, planDraft: vi.fn(async () => ({})) };
    const contextKey = automationContextKey({ channel: 'telegram', ownerPrivyId: OWNER });

    const listed = await handleAutomationAssistantTurn(deps, {
      ownerPrivyId: OWNER,
      message: 'show my automations',
      agentMint: AGENT,
      channel: 'telegram',
      contextKey,
    });
    expect(listed?.text).toContain('Morning Gmail brief');

    const result = await handleAutomationAssistantTurn(deps, {
      ownerPrivyId: OWNER,
      message: 'latest result for Morning Gmail brief automation',
      agentMint: AGENT,
      channel: 'telegram',
      contextKey,
    });
    expect(result?.text).toContain('Gmail had three important messages');
  });

  it('requires confirmation before status changes and deletes', async () => {
    const pending = createDbPendingStore(db);
    const { api, patched, deleted } = makeApi([automation()]);
    const deps = { api, pending, planDraft: vi.fn(async () => ({})) };
    const contextKey = automationContextKey({ channel: 'whatsapp', ownerPrivyId: OWNER });

    const pause = await handleAutomationAssistantTurn(deps, {
      ownerPrivyId: OWNER,
      message: 'pause Morning Gmail brief automation',
      agentMint: AGENT,
      channel: 'whatsapp',
      contextKey,
    });
    expect(pause?.text).toContain('confirm');
    expect(patched).toHaveLength(0);

    await handleAutomationAssistantTurn(deps, {
      ownerPrivyId: OWNER,
      message: 'yes',
      agentMint: AGENT,
      channel: 'whatsapp',
      contextKey,
    });
    expect(patched[0]).toMatchObject({ id: 'auto_1', patch: { status: 'paused' } });

    await handleAutomationAssistantTurn(deps, {
      ownerPrivyId: OWNER,
      message: 'delete Morning Gmail brief automation',
      agentMint: AGENT,
      channel: 'whatsapp',
      contextKey,
    });
    expect(deleted).toHaveLength(0);

    await handleAutomationAssistantTurn(deps, {
      ownerPrivyId: OWNER,
      message: 'confirm',
      agentMint: AGENT,
      channel: 'whatsapp',
      contextKey,
    });
    expect(deleted).toEqual(['auto_1']);
  });
});

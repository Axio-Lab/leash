import { ulid } from 'ulid';
import { z } from 'zod';
import type { Client } from '@libsql/client';

import { ensureAgentChatTables } from '../db-schema';

export type TriggerType = 'schedule' | 'webhook' | 'event';
export type AutomationStatus = 'enabled' | 'paused';
export type DeliveryPolicy =
  | 'history_only'
  | 'every_run'
  | 'on_failure'
  | 'on_condition'
  | 'silent';

export type AutomationWire = {
  id: string;
  owner_privy_id: string;
  agent_mint: string;
  name: string;
  description: string | null;
  instructions: string;
  status: AutomationStatus;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  source_config: Record<string, unknown>;
  delivery_policy: DeliveryPolicy;
  delivery_config: Record<string, unknown>;
  budget_per_run: string;
  budget_per_day: string;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  failure_count: number;
  retention_days: number;
  created_at: string;
  updated_at: string;
};

export type AutomationRunWire = {
  id: string;
  automation_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  output_text: string | null;
  error: string | null;
  delivery_status: string | null;
  spend_usd: string;
  created_at: string;
  finished_at: string | null;
};

export type ToolkitSummary = {
  slug: string;
  name: string;
  status?: string;
};

export type AutomationDraft = {
  agent_mint: string;
  name: string;
  description: string | null;
  instructions: string;
  status: AutomationStatus;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  source_config: Record<string, unknown>;
  delivery_policy: DeliveryPolicy;
  delivery_config: Record<string, unknown>;
  budget_per_run: string;
  budget_per_day: string;
  timezone: string;
  retention_days: number;
};

export type PendingActionKind = 'create' | 'patch' | 'delete';

export type PendingActionPayload =
  | { kind: 'create'; draft: AutomationDraft }
  | { kind: 'patch'; automation_id: string; patch: Partial<AutomationDraft>; label: string }
  | { kind: 'delete'; automation_id: string; label: string };

export type PendingAction = {
  id: string;
  ownerPrivyId: string;
  contextKey: string;
  kind: PendingActionKind;
  payload: PendingActionPayload;
  expiresAt: string;
  createdAt: string;
};

export type PendingStore = {
  save(input: {
    ownerPrivyId: string;
    contextKey: string;
    payload: PendingActionPayload;
    ttlMs?: number;
  }): Promise<PendingAction>;
  getLatest(ownerPrivyId: string, contextKey: string): Promise<PendingAction | null>;
  getById(ownerPrivyId: string, id: string): Promise<PendingAction | null>;
  consume(ownerPrivyId: string, id: string): Promise<void>;
};

export type AutomationApi = {
  listAutomations(ownerPrivyId: string): Promise<AutomationWire[]>;
  createAutomation(ownerPrivyId: string, draft: AutomationDraft): Promise<AutomationWire>;
  patchAutomation(
    ownerPrivyId: string,
    id: string,
    patch: Partial<AutomationDraft>,
  ): Promise<AutomationWire>;
  deleteAutomation(ownerPrivyId: string, id: string): Promise<void>;
  listRuns(
    ownerPrivyId: string,
    automationId: string,
    limit?: number,
  ): Promise<AutomationRunWire[]>;
};

export type DraftPlannerInput = {
  ownerPrivyId: string;
  message: string;
  agentMint: string;
  timezone: string;
  channel: 'web' | 'telegram' | 'whatsapp';
  externalConnectionId?: string | null;
  toolkits: ToolkitSummary[];
};

export type AutomationAssistantDeps = {
  api: AutomationApi;
  pending: PendingStore;
  planDraft: (input: DraftPlannerInput) => Promise<Partial<AutomationDraft>>;
};

export type AutomationAssistantInput = {
  ownerPrivyId: string;
  message: string;
  agentMint: string | null;
  channel: 'web' | 'telegram' | 'whatsapp';
  contextKey: string;
  timezone?: string;
  toolkits?: ToolkitSummary[];
  externalConnectionId?: string | null;
  pendingId?: string | null;
  forceCreateOnUnknown?: boolean;
};

export type AutomationAssistantResult = {
  handled: boolean;
  text: string;
  pending_id?: string;
  automation_id?: string;
};

const DEFAULT_PENDING_TTL_MS = 10 * 60_000;

const PartialDraftSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  instructions: z.string().min(1).max(8000).optional(),
  status: z.enum(['enabled', 'paused']).optional(),
  trigger_type: z.enum(['schedule', 'webhook', 'event']).optional(),
  trigger_config: z.record(z.unknown()).optional(),
  source_config: z.record(z.unknown()).optional(),
  delivery_policy: z
    .enum(['history_only', 'every_run', 'on_failure', 'on_condition', 'silent'])
    .optional(),
  delivery_config: z.record(z.unknown()).optional(),
  budget_per_run: z.string().optional(),
  budget_per_day: z.string().optional(),
  timezone: z.string().optional(),
  retention_days: z.coerce.number().int().min(1).max(365).optional(),
});

function normaliseMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ');
}

function lower(message: string): string {
  return normaliseMessage(message).toLowerCase();
}

export function automationContextKey(args: {
  channel: 'web' | 'telegram' | 'whatsapp';
  ownerPrivyId: string;
  externalConnectionId?: string | null;
}): string {
  if (args.externalConnectionId) return `external:${args.externalConnectionId}`;
  return `${args.channel}:${args.ownerPrivyId}`;
}

export function classifyAutomationIntent(
  message: string,
  options: { forceCreateOnUnknown?: boolean } = {},
):
  | 'confirm'
  | 'cancel'
  | 'list'
  | 'status'
  | 'result'
  | 'pause'
  | 'enable'
  | 'delete'
  | 'edit'
  | 'create'
  | null {
  const text = lower(message);
  if (/^(yes|yep|yeah|confirm|save|save it|create it|do it|approve)\.?$/i.test(text)) {
    return 'confirm';
  }
  if (/^(no|cancel|never mind|nevermind|stop)\.?$/i.test(text)) return 'cancel';
  if (!/\bautomation(s)?\b/.test(text) && !options.forceCreateOnUnknown) return null;
  if (/\b(list|show|what are|all)\b/.test(text) && /\bautomation(s)?\b/.test(text)) {
    return 'list';
  }
  if (/\b(latest|last|result|report|ran|run history|what happened)\b/.test(text)) {
    return 'result';
  }
  if (/\b(status|state|enabled|paused|running)\b/.test(text)) return 'status';
  if (/\b(pause|disable|stop)\b/.test(text)) return 'pause';
  if (/\b(enable|resume|start)\b/.test(text)) return 'enable';
  if (/\b(delete|remove)\b/.test(text)) return 'delete';
  if (/\b(edit|change|update|rename|set)\b/.test(text)) return 'edit';
  if (
    options.forceCreateOnUnknown ||
    /\b(create|new|add|set up|setup|automate|schedule|every|daily|weekly|webhook|when)\b/.test(text)
  ) {
    return 'create';
  }
  return null;
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseDraftFromPlannerText(text: string): Partial<AutomationDraft> {
  const parsed = extractJsonObject(text);
  if (!parsed) return {};
  const result = PartialDraftSchema.safeParse(parsed);
  return result.success ? result.data : {};
}

export function buildAutomationPlannerPrompt(input: DraftPlannerInput): string {
  const toolkitLine =
    input.toolkits.length > 0
      ? input.toolkits.map((t) => `${t.slug} (${t.name})`).join(', ')
      : 'none';
  return [
    'You convert a user request into one Leash automation JSON draft.',
    'Return JSON only. No markdown.',
    '',
    'Required output fields:',
    '- name: short human name',
    '- description: one sentence or null',
    '- instructions: exact task the agent should complete each run',
    '- status: "enabled" or "paused"',
    '- trigger_type: "schedule", "webhook", or "event"',
    '- trigger_config: schedule uses {schedule:"daily"|"weekly"|"interval", time:"HH:MM", weekday?:0-6, interval_minutes?:number}; webhook uses {label:string, signature_required:true}; event uses {event:"receipt.settled"|"connection.message"|"treasury.low_balance"}',
    '- source_config: {toolkit_slugs:string[]}',
    '- delivery_policy: "history_only", "every_run", "on_failure", "on_condition", or "silent"',
    '- delivery_config: object',
    '- budget_per_run: decimal string, default "0.25"',
    '- budget_per_day: decimal string, default "2"',
    '- retention_days: integer, default 30',
    '',
    `User timezone: ${input.timezone}`,
    `Available connected toolkits: ${toolkitLine}`,
    `Channel: ${input.channel}`,
    `User request: ${input.message}`,
  ].join('\n');
}

function titleFromMessage(message: string): string {
  const cleaned = normaliseMessage(message)
    .replace(
      /^(create|new|add|set up|setup|automate|schedule)\s+(an?\s+)?automation\s*(that|to)?\s*/i,
      '',
    )
    .replace(/^please\s+/i, '')
    .trim();
  const words = (cleaned || 'Agent automation').split(/\s+/).slice(0, 6).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function inferTriggerConfig(
  message: string,
): Pick<AutomationDraft, 'trigger_type' | 'trigger_config'> {
  const text = lower(message);
  const timeMatch = text.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/);
  let time = '09:00';
  if (timeMatch?.[1]) {
    let hour = Number(timeMatch[1]);
    const minute = timeMatch[2] ?? '00';
    const meridiem = timeMatch[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    time = `${String(hour).padStart(2, '0')}:${minute}`;
  }
  if (/\bwebhook\b/.test(text)) {
    return {
      trigger_type: 'webhook',
      trigger_config: { label: titleFromMessage(message), signature_required: true },
    };
  }
  if (/\breceipt\b/.test(text) && /\b(settle|settled|payment)\b/.test(text)) {
    return { trigger_type: 'event', trigger_config: { event: 'receipt.settled' } };
  }
  if (/\bmessage\b/.test(text) && /\b(connection|telegram|whatsapp|channel)\b/.test(text)) {
    return { trigger_type: 'event', trigger_config: { event: 'connection.message' } };
  }
  if (/\b(low balance|treasury)\b/.test(text)) {
    return { trigger_type: 'event', trigger_config: { event: 'treasury.low_balance' } };
  }
  if (/\bevery\s+(\d+)\s*(minute|minutes|min)\b/.test(text)) {
    const minutes = Number(text.match(/\bevery\s+(\d+)\s*(minute|minutes|min)\b/)?.[1] ?? 60);
    return {
      trigger_type: 'schedule',
      trigger_config: { schedule: 'interval', interval_minutes: minutes || 60 },
    };
  }
  if (
    /\bweekly|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday\b/.test(
      text,
    )
  ) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekday = weekdays.findIndex((d) => text.includes(d));
    return {
      trigger_type: 'schedule',
      trigger_config: { schedule: 'weekly', weekday: weekday >= 0 ? weekday : 1, time },
    };
  }
  return { trigger_type: 'schedule', trigger_config: { schedule: 'daily', time } };
}

function inferToolkitSlugs(message: string, toolkits: ToolkitSummary[]): string[] {
  const text = lower(message);
  const hits = toolkits
    .filter((t) => {
      const slug = t.slug.toLowerCase();
      const name = t.name.toLowerCase();
      return text.includes(slug) || text.includes(name);
    })
    .map((t) => t.slug);
  return [...new Set(hits)].sort();
}

export function heuristicDraft(input: DraftPlannerInput): Partial<AutomationDraft> {
  const trigger = inferTriggerConfig(input.message);
  const delivery =
    input.externalConnectionId && input.channel !== 'web'
      ? {
          delivery_policy: 'every_run' as DeliveryPolicy,
          delivery_config: {
            kind: 'external_chat',
            connection_id: input.externalConnectionId,
            channel: input.channel,
          },
        }
      : { delivery_policy: 'history_only' as DeliveryPolicy, delivery_config: {} };
  return {
    agent_mint: input.agentMint,
    name: titleFromMessage(input.message),
    description: normaliseMessage(input.message).slice(0, 240) || null,
    instructions: normaliseMessage(input.message),
    status: 'enabled',
    ...trigger,
    source_config: { toolkit_slugs: inferToolkitSlugs(input.message, input.toolkits) },
    ...delivery,
    budget_per_run: '0.25',
    budget_per_day: '2',
    timezone: input.timezone,
    retention_days: 30,
  };
}

function mergeDraft(input: DraftPlannerInput, planned: Partial<AutomationDraft>): AutomationDraft {
  const fallback = heuristicDraft(input);
  const merged = { ...fallback, ...planned };
  const parsed = z
    .object({
      agent_mint: z.string().min(1),
      name: z.string().min(1).max(120),
      description: z.string().max(1000).nullable(),
      instructions: z.string().min(1).max(8000),
      status: z.enum(['enabled', 'paused']),
      trigger_type: z.enum(['schedule', 'webhook', 'event']),
      trigger_config: z.record(z.unknown()),
      source_config: z.record(z.unknown()),
      delivery_policy: z.enum([
        'history_only',
        'every_run',
        'on_failure',
        'on_condition',
        'silent',
      ]),
      delivery_config: z.record(z.unknown()),
      budget_per_run: z.string(),
      budget_per_day: z.string(),
      timezone: z.string().min(1),
      retention_days: z.coerce.number().int().min(1).max(365),
    })
    .parse(merged);
  return parsed;
}

function validateDraft(draft: AutomationDraft): string[] {
  const missing: string[] = [];
  if (!draft.name.trim()) missing.push('name');
  if (!draft.instructions.trim()) missing.push('instructions');
  if (draft.trigger_type === 'schedule') {
    const schedule = draft.trigger_config.schedule;
    if (schedule !== 'daily' && schedule !== 'weekly' && schedule !== 'interval') {
      missing.push('schedule');
    }
  }
  const perRun = Number.parseFloat(draft.budget_per_run);
  const perDay = Number.parseFloat(draft.budget_per_day);
  if (!Number.isFinite(perRun) || perRun < 0) missing.push('cap per run');
  if (!Number.isFinite(perDay) || perDay < 0) missing.push('cap per day');
  return missing;
}

function triggerSummary(draft: Pick<AutomationDraft, 'trigger_type' | 'trigger_config'>): string {
  if (draft.trigger_type === 'webhook') return 'signed webhook';
  if (draft.trigger_type === 'event') return String(draft.trigger_config.event ?? 'event');
  const schedule = String(draft.trigger_config.schedule ?? 'daily');
  if (schedule === 'interval') {
    return `every ${draft.trigger_config.interval_minutes ?? 60} minutes`;
  }
  return `${schedule} at ${draft.trigger_config.time ?? '09:00'}`;
}

function sourceSummary(sourceConfig: Record<string, unknown>): string {
  const slugs = Array.isArray(sourceConfig.toolkit_slugs)
    ? sourceConfig.toolkit_slugs.map(String).filter(Boolean)
    : [];
  return slugs.length > 0 ? slugs.join(', ') : 'none selected';
}

export function formatAutomationReview(draft: AutomationDraft): string {
  return [
    `Review this automation before I save it:`,
    '',
    `Name: ${draft.name}`,
    `Trigger: ${triggerSummary(draft)}`,
    `Sources: ${sourceSummary(draft.source_config)}`,
    `Report: ${draft.delivery_policy}`,
    `Caps: $${draft.budget_per_run}/run, $${draft.budget_per_day}/day`,
    `Retention: ${draft.retention_days} days`,
    '',
    `Instructions: ${draft.instructions}`,
    '',
    'Reply `confirm` to save it or `cancel` to discard it.',
  ].join('\n');
}

function formatAutomationList(items: AutomationWire[]): string {
  if (items.length === 0) return 'You do not have any automations yet.';
  const lines = items.slice(0, 10).map((a, i) => {
    const state = a.status === 'enabled' ? 'enabled' : 'paused';
    return `${i + 1}. ${a.name} — ${state}, ${triggerSummary({
      trigger_type: a.trigger_type,
      trigger_config: a.trigger_config,
    })}`;
  });
  return ['Your automations:', '', ...lines].join('\n');
}

function formatLatestRun(automation: AutomationWire, runs: AutomationRunWire[]): string {
  if (runs.length === 0) return `${automation.name} has no recorded runs yet.`;
  const run = runs[0]!;
  const status = run.status;
  const when = run.finished_at ?? run.created_at;
  const detail = run.error || run.output_text || 'No report text was recorded.';
  return [`${automation.name} latest run: ${status}`, `When: ${when}`, '', detail].join('\n');
}

function formatStatus(automation: AutomationWire, runs: AutomationRunWire[]): string {
  const latest = runs[0];
  return [
    `${automation.name} is ${automation.status}.`,
    `Trigger: ${triggerSummary({ trigger_type: automation.trigger_type, trigger_config: automation.trigger_config })}`,
    `Last run: ${automation.last_run_at ?? 'never'}${automation.last_status ? ` (${automation.last_status})` : ''}`,
    latest ? `Latest result: ${latest.status}` : 'Latest result: none yet',
  ].join('\n');
}

function nameQuery(message: string): string | null {
  const text = normaliseMessage(message);
  const quoted = text.match(/"([^"]+)"/)?.[1] ?? text.match(/'([^']+)'/)?.[1];
  if (quoted) return quoted.toLowerCase();
  return text
    .replace(
      /\b(automation|automations|status|result|latest|last|pause|enable|resume|delete|remove|edit|change|update|show|the|my|for|of|called|named)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pickAutomation(items: AutomationWire[], message: string): AutomationWire | null {
  if (items.length === 0) return null;
  const query = nameQuery(message);
  if (!query) return items[0] ?? null;
  const exact = items.find((a) => a.name.toLowerCase() === query);
  if (exact) return exact;
  return (
    items.find((a) => a.name.toLowerCase().includes(query)) ??
    items.find((a) => query.includes(a.name.toLowerCase())) ??
    items[0] ??
    null
  );
}

function extractPatch(message: string): Partial<AutomationDraft> {
  const text = lower(message);
  const patch: Partial<AutomationDraft> = {};
  const perRun = text.match(/\bper run\b[^\d]*(\d+(?:\.\d+)?)/)?.[1];
  const perDay = text.match(/\bper day\b[^\d]*(\d+(?:\.\d+)?)/)?.[1];
  if (perRun) patch.budget_per_run = perRun;
  if (perDay) patch.budget_per_day = perDay;
  if (/\bhistory only\b/.test(text)) {
    patch.delivery_policy = 'history_only';
    patch.delivery_config = {};
  }
  if (/\bevery run\b/.test(text)) patch.delivery_policy = 'every_run';
  if (/\bfailure only|on failure\b/.test(text)) patch.delivery_policy = 'on_failure';
  const name = normaliseMessage(message).match(/\brename\b.+?\bto\s+(.+)$/i)?.[1];
  if (name) patch.name = name.slice(0, 120);
  return patch;
}

async function executePending(
  deps: AutomationAssistantDeps,
  ownerPrivyId: string,
  pending: PendingAction,
): Promise<AutomationAssistantResult> {
  await deps.pending.consume(ownerPrivyId, pending.id);
  if (pending.payload.kind === 'create') {
    const saved = await deps.api.createAutomation(ownerPrivyId, pending.payload.draft);
    return {
      handled: true,
      automation_id: saved.id,
      text: `Saved automation: ${saved.name}. It is ${saved.status}.`,
    };
  }
  if (pending.payload.kind === 'patch') {
    const saved = await deps.api.patchAutomation(
      ownerPrivyId,
      pending.payload.automation_id,
      pending.payload.patch,
    );
    return {
      handled: true,
      automation_id: saved.id,
      text: `Updated automation: ${saved.name}.`,
    };
  }
  await deps.api.deleteAutomation(ownerPrivyId, pending.payload.automation_id);
  return {
    handled: true,
    automation_id: pending.payload.automation_id,
    text: `Deleted automation: ${pending.payload.label}.`,
  };
}

export async function handleAutomationAssistantTurn(
  deps: AutomationAssistantDeps,
  input: AutomationAssistantInput,
): Promise<AutomationAssistantResult | null> {
  const message = normaliseMessage(input.message);
  const intent = classifyAutomationIntent(message, {
    forceCreateOnUnknown: input.forceCreateOnUnknown,
  });
  const pending = input.pendingId
    ? await deps.pending.getById(input.ownerPrivyId, input.pendingId)
    : await deps.pending.getLatest(input.ownerPrivyId, input.contextKey);

  if (intent === 'cancel' && pending) {
    await deps.pending.consume(input.ownerPrivyId, pending.id);
    return { handled: true, text: 'Cancelled. I did not change any automations.' };
  }
  if (intent === 'confirm' && pending) {
    return executePending(deps, input.ownerPrivyId, pending);
  }
  if (intent === 'confirm') {
    return { handled: true, text: 'There is no pending automation change to confirm.' };
  }
  if (intent === 'cancel') {
    return { handled: true, text: 'There is no pending automation change to cancel.' };
  }
  if (!intent) return null;
  if (!input.agentMint && intent === 'create') {
    return {
      handled: true,
      text: 'Create or mint an agent first. Automations need an agent before they can be saved.',
    };
  }

  if (intent === 'list') {
    const items = await deps.api.listAutomations(input.ownerPrivyId);
    return { handled: true, text: formatAutomationList(items) };
  }

  if (intent === 'status' || intent === 'result') {
    const items = await deps.api.listAutomations(input.ownerPrivyId);
    const automation = pickAutomation(items, message);
    if (!automation) return { handled: true, text: 'I could not find an automation to inspect.' };
    const runs = await deps.api.listRuns(input.ownerPrivyId, automation.id, 3);
    return {
      handled: true,
      automation_id: automation.id,
      text:
        intent === 'result' ? formatLatestRun(automation, runs) : formatStatus(automation, runs),
    };
  }

  if (intent === 'pause' || intent === 'enable') {
    const items = await deps.api.listAutomations(input.ownerPrivyId);
    const automation = pickAutomation(items, message);
    if (!automation) return { handled: true, text: 'I could not find an automation to update.' };
    const status: AutomationStatus = intent === 'pause' ? 'paused' : 'enabled';
    const pendingAction = await deps.pending.save({
      ownerPrivyId: input.ownerPrivyId,
      contextKey: input.contextKey,
      payload: {
        kind: 'patch',
        automation_id: automation.id,
        label: automation.name,
        patch: { status },
      },
    });
    return {
      handled: true,
      pending_id: pendingAction.id,
      automation_id: automation.id,
      text: `Review this change: set ${automation.name} to ${status}.\n\nReply \`confirm\` to apply it or \`cancel\` to discard it.`,
    };
  }

  if (intent === 'delete') {
    const items = await deps.api.listAutomations(input.ownerPrivyId);
    const automation = pickAutomation(items, message);
    if (!automation) return { handled: true, text: 'I could not find an automation to delete.' };
    const pendingAction = await deps.pending.save({
      ownerPrivyId: input.ownerPrivyId,
      contextKey: input.contextKey,
      payload: { kind: 'delete', automation_id: automation.id, label: automation.name },
    });
    return {
      handled: true,
      pending_id: pendingAction.id,
      automation_id: automation.id,
      text: `Review this deletion: ${automation.name}.\n\nReply \`confirm\` to delete it or \`cancel\` to keep it.`,
    };
  }

  if (intent === 'edit') {
    const items = await deps.api.listAutomations(input.ownerPrivyId);
    const automation = pickAutomation(items, message);
    if (!automation) return { handled: true, text: 'I could not find an automation to edit.' };
    const patch = extractPatch(message);
    if (Object.keys(patch).length === 0) {
      return {
        handled: true,
        text: 'Tell me what to change, like `set cap per day to 5`, `set cap per run to 0.50`, or `rename to Morning brief`.',
      };
    }
    const pendingAction = await deps.pending.save({
      ownerPrivyId: input.ownerPrivyId,
      contextKey: input.contextKey,
      payload: { kind: 'patch', automation_id: automation.id, label: automation.name, patch },
    });
    return {
      handled: true,
      pending_id: pendingAction.id,
      automation_id: automation.id,
      text: `Review this edit for ${automation.name}: ${Object.keys(patch).join(', ')}.\n\nReply \`confirm\` to apply it or \`cancel\` to discard it.`,
    };
  }

  const plannerInput: DraftPlannerInput = {
    ownerPrivyId: input.ownerPrivyId,
    message,
    agentMint: input.agentMint ?? '',
    timezone: input.timezone ?? 'UTC',
    channel: input.channel,
    externalConnectionId: input.externalConnectionId ?? null,
    toolkits: input.toolkits ?? [],
  };
  const planned = await deps.planDraft(plannerInput);
  const draft = mergeDraft(plannerInput, planned);
  const missing = validateDraft(draft);
  if (missing.length > 0) {
    return {
      handled: true,
      text: `I need ${missing.join(', ')} before I can draft this automation.`,
    };
  }
  const pendingAction = await deps.pending.save({
    ownerPrivyId: input.ownerPrivyId,
    contextKey: input.contextKey,
    payload: { kind: 'create', draft },
    ttlMs: DEFAULT_PENDING_TTL_MS,
  });
  return {
    handled: true,
    pending_id: pendingAction.id,
    text: formatAutomationReview(draft),
  };
}

function rowToPending(row: Record<string, unknown>): PendingAction {
  const payload = JSON.parse(String(row.payload)) as PendingActionPayload;
  return {
    id: String(row.id),
    ownerPrivyId: String(row.owner_privy_id),
    contextKey: String(row.context_key),
    kind: String(row.kind) as PendingActionKind,
    payload,
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  };
}

export function createDbPendingStore(db: Client): PendingStore {
  async function ensure(): Promise<void> {
    await ensureAgentChatTables(db);
  }
  return {
    async save(input) {
      await ensure();
      const id = ulid();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_PENDING_TTL_MS));
      await db.execute({
        sql: `INSERT INTO automation_pending_actions (
          id, owner_privy_id, context_key, kind, payload, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.ownerPrivyId,
          input.contextKey,
          input.payload.kind,
          JSON.stringify(input.payload),
          expiresAt.toISOString(),
          now.toISOString(),
        ],
      });
      const found = await this.getById(input.ownerPrivyId, id);
      if (!found) throw new Error('pending action insert succeeded but lookup failed');
      return found;
    },
    async getLatest(ownerPrivyId, contextKey) {
      await ensure();
      const res = await db.execute({
        sql: `SELECT * FROM automation_pending_actions
          WHERE owner_privy_id = ? AND context_key = ? AND expires_at > ?
          ORDER BY created_at DESC LIMIT 1`,
        args: [ownerPrivyId, contextKey, new Date().toISOString()],
      });
      const row = res.rows[0];
      return row ? rowToPending(row as Record<string, unknown>) : null;
    },
    async getById(ownerPrivyId, id) {
      await ensure();
      const res = await db.execute({
        sql: `SELECT * FROM automation_pending_actions
          WHERE owner_privy_id = ? AND id = ? AND expires_at > ?
          LIMIT 1`,
        args: [ownerPrivyId, id, new Date().toISOString()],
      });
      const row = res.rows[0];
      return row ? rowToPending(row as Record<string, unknown>) : null;
    },
    async consume(ownerPrivyId, id) {
      await ensure();
      await db.execute({
        sql: `DELETE FROM automation_pending_actions WHERE owner_privy_id = ? AND id = ?`,
        args: [ownerPrivyId, id],
      });
    },
  };
}

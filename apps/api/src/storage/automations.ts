/**
 * Storage helpers for Agents Automation.
 *
 * Automations are platform-owned rows: the BFF authenticates the browser
 * with Privy, then calls the admin routes with `owner_privy_id`. Storage
 * helpers keep that owner filter explicit so route handlers cannot
 * accidentally expose another user's background jobs.
 */

import { ulid } from 'ulid';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';

export type AutomationStatus = 'enabled' | 'paused';
export type AutomationTriggerType = 'schedule' | 'webhook' | 'event';
export type AutomationDeliveryPolicy =
  | 'history_only'
  | 'every_run'
  | 'on_failure'
  | 'on_condition'
  | 'silent';

export type AutomationRow = {
  id: string;
  ownerPrivyId: string;
  agentMint: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  sourceConfig: Record<string, unknown>;
  deliveryPolicy: AutomationDeliveryPolicy;
  deliveryConfig: Record<string, unknown>;
  budgetPerRun: string;
  budgetPerDay: string;
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  failureCount: number;
  retentionDays: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type AutomationRunRow = {
  id: string;
  automationId: string;
  ownerPrivyId: string;
  agentMint: string;
  triggerType: AutomationTriggerType;
  triggerPayload: Record<string, unknown>;
  status: AutomationRunStatus;
  outputText: string | null;
  error: string | null;
  sourceSummary: Record<string, unknown>;
  deliveryStatus: string | null;
  deliveryResult: Record<string, unknown>;
  spendUsd: string;
  receipts: unknown[];
  idempotencyKey: string | null;
  claimedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

function parseObject(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseArray(raw: unknown): unknown[] {
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToAutomation(row: Record<string, unknown>): AutomationRow {
  const status = String(row.status);
  if (status !== 'enabled' && status !== 'paused') {
    throw new Error(`unexpected automation status: ${status}`);
  }
  const triggerType = String(row.trigger_type);
  if (triggerType !== 'schedule' && triggerType !== 'webhook' && triggerType !== 'event') {
    throw new Error(`unexpected automation trigger: ${triggerType}`);
  }
  const deliveryPolicy = String(row.delivery_policy);
  if (
    deliveryPolicy !== 'history_only' &&
    deliveryPolicy !== 'every_run' &&
    deliveryPolicy !== 'on_failure' &&
    deliveryPolicy !== 'on_condition' &&
    deliveryPolicy !== 'silent'
  ) {
    throw new Error(`unexpected automation delivery policy: ${deliveryPolicy}`);
  }
  return {
    id: String(row.id),
    ownerPrivyId: String(row.owner_privy_id),
    agentMint: String(row.agent_mint),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    status,
    triggerType,
    triggerConfig: parseObject(row.trigger_config),
    sourceConfig: parseObject(row.source_config),
    deliveryPolicy,
    deliveryConfig: parseObject(row.delivery_config),
    budgetPerRun: String(row.budget_per_run),
    budgetPerDay: String(row.budget_per_day),
    timezone: String(row.timezone),
    nextRunAt: row.next_run_at == null ? null : String(row.next_run_at),
    lastRunAt: row.last_run_at == null ? null : String(row.last_run_at),
    lastStatus: row.last_status == null ? null : String(row.last_status),
    failureCount: Number(row.failure_count ?? 0),
    retentionDays: Number(row.retention_days ?? 30),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToRun(row: Record<string, unknown>): AutomationRunRow {
  const triggerType = String(row.trigger_type) as AutomationTriggerType;
  const status = String(row.status) as AutomationRunStatus;
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    ownerPrivyId: String(row.owner_privy_id),
    agentMint: String(row.agent_mint),
    triggerType,
    triggerPayload: parseObject(row.trigger_payload),
    status,
    outputText: row.output_text == null ? null : String(row.output_text),
    error: row.error == null ? null : String(row.error),
    sourceSummary: parseObject(row.source_summary),
    deliveryStatus: row.delivery_status == null ? null : String(row.delivery_status),
    deliveryResult: parseObject(row.delivery_result),
    spendUsd: String(row.spend_usd ?? '0'),
    receipts: parseArray(row.receipts),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    claimedBy: row.claimed_by == null ? null : String(row.claimed_by),
    startedAt: row.started_at == null ? null : String(row.started_at),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
    createdAt: String(row.created_at),
  };
}

export async function createAutomation(
  db: DbClient,
  input: {
    ownerPrivyId: string;
    agentMint: string;
    name: string;
    description?: string | null;
    status?: AutomationStatus;
    triggerType: AutomationTriggerType;
    triggerConfig?: Record<string, unknown>;
    sourceConfig?: Record<string, unknown>;
    deliveryPolicy?: AutomationDeliveryPolicy;
    deliveryConfig?: Record<string, unknown>;
    budgetPerRun?: string;
    budgetPerDay?: string;
    timezone?: string;
    nextRunAt?: string | null;
    retentionDays?: number;
  },
): Promise<AutomationRow> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO automations (
      id, owner_privy_id, agent_mint, name, description, status,
      trigger_type, trigger_config, source_config,
      delivery_policy, delivery_config,
      budget_per_run, budget_per_day, timezone, next_run_at, retention_days
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ownerPrivyId,
      input.agentMint,
      input.name,
      input.description ?? null,
      input.status ?? 'paused',
      input.triggerType,
      JSON.stringify(input.triggerConfig ?? {}),
      JSON.stringify(input.sourceConfig ?? {}),
      input.deliveryPolicy ?? 'history_only',
      JSON.stringify(input.deliveryConfig ?? {}),
      input.budgetPerRun ?? '0',
      input.budgetPerDay ?? '0',
      input.timezone ?? 'UTC',
      input.nextRunAt ?? null,
      input.retentionDays ?? 30,
    ],
  );
  const created = await getAutomationForOwner(db, input.ownerPrivyId, id);
  if (!created) throw new Error('automation insert succeeded but lookup failed');
  return created;
}

export async function listAutomationsForOwner(
  db: DbClient,
  ownerPrivyId: string,
  limit = 100,
): Promise<AutomationRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM automations
     WHERE owner_privy_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
    [ownerPrivyId, limit],
  );
  return res.rows.map((r) => rowToAutomation(r as Record<string, unknown>));
}

export async function getAutomationForOwner(
  db: DbClient,
  ownerPrivyId: string,
  id: string,
): Promise<AutomationRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM automations
     WHERE id = ? AND owner_privy_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [id, ownerPrivyId],
  );
  const row = res.rows[0];
  return row ? rowToAutomation(row as Record<string, unknown>) : null;
}

export async function updateAutomationForOwner(
  db: DbClient,
  ownerPrivyId: string,
  id: string,
  patch: Partial<{
    agentMint: string;
    name: string;
    description: string | null;
    status: AutomationStatus;
    triggerType: AutomationTriggerType;
    triggerConfig: Record<string, unknown>;
    sourceConfig: Record<string, unknown>;
    deliveryPolicy: AutomationDeliveryPolicy;
    deliveryConfig: Record<string, unknown>;
    budgetPerRun: string;
    budgetPerDay: string;
    timezone: string;
    nextRunAt: string | null;
    retentionDays: number;
  }>,
): Promise<AutomationRow | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    fields.push(sql);
    params.push(value);
  };
  if (patch.agentMint !== undefined) add('agent_mint = ?', patch.agentMint);
  if (patch.name !== undefined) add('name = ?', patch.name);
  if (patch.description !== undefined) add('description = ?', patch.description);
  if (patch.status !== undefined) add('status = ?', patch.status);
  if (patch.triggerType !== undefined) add('trigger_type = ?', patch.triggerType);
  if (patch.triggerConfig !== undefined) {
    add('trigger_config = ?', JSON.stringify(patch.triggerConfig));
  }
  if (patch.sourceConfig !== undefined)
    add('source_config = ?', JSON.stringify(patch.sourceConfig));
  if (patch.deliveryPolicy !== undefined) add('delivery_policy = ?', patch.deliveryPolicy);
  if (patch.deliveryConfig !== undefined) {
    add('delivery_config = ?', JSON.stringify(patch.deliveryConfig));
  }
  if (patch.budgetPerRun !== undefined) add('budget_per_run = ?', patch.budgetPerRun);
  if (patch.budgetPerDay !== undefined) add('budget_per_day = ?', patch.budgetPerDay);
  if (patch.timezone !== undefined) add('timezone = ?', patch.timezone);
  if (patch.nextRunAt !== undefined) add('next_run_at = ?', patch.nextRunAt);
  if (patch.retentionDays !== undefined) add('retention_days = ?', patch.retentionDays);
  if (fields.length === 0) return getAutomationForOwner(db, ownerPrivyId, id);
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  params.push(id, ownerPrivyId);
  await execute(
    db,
    `UPDATE automations
     SET ${fields.join(', ')}
     WHERE id = ? AND owner_privy_id = ? AND deleted_at IS NULL`,
    params as never[],
  );
  return getAutomationForOwner(db, ownerPrivyId, id);
}

export async function deleteAutomationForOwner(
  db: DbClient,
  ownerPrivyId: string,
  id: string,
): Promise<boolean> {
  const res = await execute(
    db,
    `UPDATE automations
     SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         status = 'paused',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? AND owner_privy_id = ? AND deleted_at IS NULL`,
    [id, ownerPrivyId],
  );
  return res.rowsAffected > 0;
}

export async function listAutomationRunsForOwner(
  db: DbClient,
  ownerPrivyId: string,
  automationId: string,
  limit = 50,
): Promise<AutomationRunRow[]> {
  const automation = await getAutomationForOwner(db, ownerPrivyId, automationId);
  if (!automation) return [];
  const res = await execute(
    db,
    `SELECT * FROM automation_runs
     WHERE automation_id = ? AND owner_privy_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [automationId, ownerPrivyId, limit],
  );
  return res.rows.map((r) => rowToRun(r as Record<string, unknown>));
}

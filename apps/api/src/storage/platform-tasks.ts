/**
 * Storage helpers for `tasks` + `task_activities` (schema v8).
 *
 * The agent-runtime worker claims pending rows by setting status from
 * `pending` → `running` (best-effort optimistic claim — Phase 1 has a
 * single worker, so there's no contention; Phase 2+ will add a leased
 * `claimed_by` column when we run multiple workers).
 */

import { ulid } from 'ulid';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'out_of_budget';

export type Task = {
  id: string;
  agentMint: string;
  prompt: string;
  budgetCap: string;
  status: TaskStatus;
  spent: string;
  finalOutput: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

function rowToTask(row: Record<string, unknown>): Task {
  const status = String(row.status);
  if (
    status !== 'pending' &&
    status !== 'running' &&
    status !== 'done' &&
    status !== 'failed' &&
    status !== 'out_of_budget'
  ) {
    throw new Error(`unexpected task status: ${status}`);
  }
  return {
    id: String(row.id),
    agentMint: String(row.agent_mint),
    prompt: String(row.prompt),
    budgetCap: String(row.budget_cap),
    status,
    spent: String(row.spent),
    finalOutput: row.final_output != null ? String(row.final_output) : null,
    error: row.error != null ? String(row.error) : null,
    startedAt: row.started_at != null ? String(row.started_at) : null,
    finishedAt: row.finished_at != null ? String(row.finished_at) : null,
    createdAt: String(row.created_at),
  };
}

export async function createTask(
  db: DbClient,
  args: { agentMint: string; prompt: string; budgetCap: string },
): Promise<Task> {
  const id = ulid();
  await execute(db, `INSERT INTO tasks (id, agent_mint, prompt, budget_cap) VALUES (?, ?, ?, ?)`, [
    id,
    args.agentMint,
    args.prompt,
    args.budgetCap,
  ]);
  const created = await getTask(db, id);
  if (!created) throw new Error('task insert succeeded but lookup failed');
  return created;
}

export async function getTask(db: DbClient, id: string): Promise<Task | null> {
  const res = await execute(db, `SELECT * FROM tasks WHERE id = ? LIMIT 1`, [id]);
  const row = res.rows[0];
  return row ? rowToTask(row as Record<string, unknown>) : null;
}

export async function listTasksForAgent(
  db: DbClient,
  agentMint: string,
  limit = 50,
): Promise<Task[]> {
  const res = await execute(
    db,
    `SELECT * FROM tasks WHERE agent_mint = ? ORDER BY created_at DESC LIMIT ?`,
    [agentMint, limit],
  );
  return res.rows.map((r) => rowToTask(r as Record<string, unknown>));
}

export async function claimNextPendingTask(db: DbClient): Promise<Task | null> {
  const candidate = await execute(
    db,
    `SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`,
  );
  const row = candidate.rows[0];
  if (!row) return null;
  const id = String((row as Record<string, unknown>).id);
  const upd = await execute(
    db,
    `UPDATE tasks SET status = 'running', started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'`,
    [id],
  );
  if (upd.rowsAffected === 0) return null;
  return getTask(db, id);
}

export async function setTaskStatus(
  db: DbClient,
  id: string,
  status: TaskStatus,
  args?: { finalOutput?: string; error?: string; spent?: string },
): Promise<void> {
  const fields: string[] = ['status = ?'];
  const params: unknown[] = [status];
  if (status === 'done' || status === 'failed' || status === 'out_of_budget') {
    fields.push("finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  }
  if (args?.finalOutput !== undefined) {
    fields.push('final_output = ?');
    params.push(args.finalOutput);
  }
  if (args?.error !== undefined) {
    fields.push('error = ?');
    params.push(args.error);
  }
  if (args?.spent !== undefined) {
    fields.push('spent = ?');
    params.push(args.spent);
  }
  params.push(id);
  await execute(db, `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, params as never[]);
}

// ── activities ───────────────────────────────────────────────────────

export type ActivityType = 'think' | 'tool_call' | 'payment' | 'tool_result' | 'done' | 'error';

export type TaskActivity = {
  id: string;
  taskId: string;
  type: ActivityType;
  payload: Record<string, unknown>;
  costUsdc: string | null;
  receiptId: string | null;
  createdAt: string;
};

function rowToActivity(row: Record<string, unknown>): TaskActivity {
  const type = String(row.type) as ActivityType;
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.payload ?? '{}'));
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    type,
    payload,
    costUsdc: row.cost_usdc != null ? String(row.cost_usdc) : null,
    receiptId: row.receipt_id != null ? String(row.receipt_id) : null,
    createdAt: String(row.created_at),
  };
}

export async function recordTaskActivity(
  db: DbClient,
  args: {
    taskId: string;
    type: ActivityType;
    payload?: Record<string, unknown>;
    costUsdc?: string;
    receiptId?: string;
  },
): Promise<TaskActivity> {
  const id = ulid();
  await execute(
    db,
    `INSERT INTO task_activities (id, task_id, type, payload, cost_usdc, receipt_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      args.taskId,
      args.type,
      JSON.stringify(args.payload ?? {}),
      args.costUsdc ?? null,
      args.receiptId ?? null,
    ],
  );
  const res = await execute(db, 'SELECT * FROM task_activities WHERE id = ?', [id]);
  const row = res.rows[0];
  if (!row) throw new Error('activity insert succeeded but lookup failed');
  return rowToActivity(row as Record<string, unknown>);
}

export async function listTaskActivities(db: DbClient, taskId: string): Promise<TaskActivity[]> {
  const res = await execute(
    db,
    // `created_at` can tie when activities are recorded in rapid succession.
    // Tie-break with `rowid` (insertion order) so replay order is stable
    // across environments (CI/local) and matches user-visible task flow.
    `SELECT * FROM task_activities WHERE task_id = ? ORDER BY created_at ASC, rowid ASC`,
    [taskId],
  );
  return res.rows.map((r) => rowToActivity(r as Record<string, unknown>));
}

/**
 * Direct database I/O for the agent-runtime worker.
 *
 * The schema here is owned by `apps/api/src/storage/turso.ts` (v6/v7/v8).
 * This module reads/writes the same tables but lives in its own
 * package so the worker doesn't need to depend on `apps/api`'s server
 * code (and its routing / env layer).
 */

import type { Client } from '@libsql/client';
import { ulid } from 'ulid';

import type { ActivityEnvelope, ActivityType, Agent, Capability, Task } from './types.js';

function rowToAgent(row: Record<string, unknown>): Agent {
  let capabilities: Capability[] = [];
  try {
    const parsed = JSON.parse(String(row.capabilities ?? '[]'));
    if (Array.isArray(parsed)) capabilities = parsed as Capability[];
  } catch {
    capabilities = [];
  }
  const network = String(row.network);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`unexpected network: ${network}`);
  }
  const provider = String(row.llm_provider);
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`unexpected llm_provider: ${provider}`);
  }
  return {
    mint: String(row.mint),
    name: String(row.name),
    ownerWallet: String(row.owner_wallet),
    network,
    model: String(row.model),
    systemPrompt: String(row.system_prompt),
    capabilities,
    budget: {
      perAction: String(row.budget_per_action),
      perTask: String(row.budget_per_task),
      perDay: String(row.budget_per_day),
    },
    treasury: String(row.treasury),
    encryptedLlmKey: String(row.encrypted_llm_key),
    llmProvider: provider,
  };
}

export async function getAgent(db: Client, mint: string): Promise<Agent | null> {
  const r = await db.execute({
    sql: `SELECT * FROM agents WHERE mint = ? AND status = 'active' LIMIT 1`,
    args: [mint],
  });
  const row = r.rows[0];
  if (!row) return null;
  return rowToAgent(row as Record<string, unknown>);
}

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
  };
}

/**
 * Optimistic single-row claim. The first worker to set status →
 * 'running' wins. Returns null when the queue is empty or another
 * worker raced us.
 */
export async function claimNextTask(db: Client): Promise<Task | null> {
  const cand = await db.execute({
    sql: `SELECT id FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`,
    args: [],
  });
  const idCell = cand.rows[0]?.id;
  if (idCell == null) return null;
  const id = String(idCell);
  const upd = await db.execute({
    sql: `UPDATE tasks SET status = 'running', started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'`,
    args: [id],
  });
  if (upd.rowsAffected === 0) return null;
  const r = await db.execute({ sql: `SELECT * FROM tasks WHERE id = ?`, args: [id] });
  return rowToTask(r.rows[0] as Record<string, unknown>);
}

export async function setTaskFinal(
  db: Client,
  id: string,
  status: 'done' | 'failed' | 'out_of_budget',
  args?: { finalOutput?: string; error?: string; spent?: string },
): Promise<void> {
  const fields: string[] = ['status = ?', "finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
  const params: unknown[] = [status];
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
  await db.execute({
    sql: `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`,
    args: params as never[],
  });
}

export async function recordActivity(
  db: Client,
  args: {
    taskId: string;
    agentMint: string;
    type: ActivityType;
    payload?: Record<string, unknown>;
    costUsdc?: string;
    receiptId?: string;
  },
): Promise<ActivityEnvelope> {
  const id = ulid();
  await db.execute({
    sql: `INSERT INTO task_activities (id, task_id, type, payload, cost_usdc, receipt_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      args.taskId,
      args.type,
      JSON.stringify(args.payload ?? {}),
      args.costUsdc ?? null,
      args.receiptId ?? null,
    ],
  });
  const r = await db.execute({
    sql: `SELECT * FROM task_activities WHERE id = ?`,
    args: [id],
  });
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    agentMint: args.agentMint,
    type: args.type,
    payload: args.payload ?? {},
    costUsdc: args.costUsdc ?? null,
    receiptId: args.receiptId ?? null,
    createdAt: String(row.created_at),
  };
}

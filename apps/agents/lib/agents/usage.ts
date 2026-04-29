import { ulid } from 'ulid';

import { getDb } from '@/lib/db';
import { ensureAgentChatTables } from '@/lib/db-schema';

export type TurnUsage = {
  privyId: string;
  agentMint?: string | null;
  threadId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  mcpCalls: number;
  paidBy: 'user' | 'platform';
};

export async function recordTurnUsage(row: TurnUsage): Promise<void> {
  const db = getDb();
  await ensureAgentChatTables(db);
  await db.execute({
    sql: `INSERT INTO agent_usage (
      id, privy_id, agent_mint, thread_id, model,
      input_tokens, output_tokens, duration_ms, mcp_calls, paid_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      ulid(),
      row.privyId,
      row.agentMint ?? null,
      row.threadId,
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.durationMs,
      row.mcpCalls,
      row.paidBy,
    ],
  });
}

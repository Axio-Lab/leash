import type { Client } from '@libsql/client';

/**
 * Chat / usage tables stored in the shared Turso DB (same file as API index).
 */
export async function ensureAgentChatTables(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS user_llm_keys (
      privy_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      envelope TEXT NOT NULL,
      last4 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_usage (
      id TEXT PRIMARY KEY,
      privy_id TEXT NOT NULL,
      agent_mint TEXT,
      thread_id TEXT,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      mcp_calls INTEGER NOT NULL DEFAULT 0,
      paid_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_usage_privy_created ON agent_usage(privy_id, created_at);

    CREATE TABLE IF NOT EXISTS user_agent_settings (
      privy_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      model_tier TEXT NOT NULL DEFAULT 'sonnet',
      updated_at TEXT NOT NULL
    );
  `);
}

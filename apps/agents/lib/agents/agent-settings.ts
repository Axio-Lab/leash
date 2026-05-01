import { getDb } from '@/lib/db';
import { ensureAgentChatTables } from '@/lib/db-schema';
import { AGENT_MODEL_TIERS, DEFAULT_AGENT_MODEL_TIER, type AgentModelTier } from '@/lib/env';

/**
 * Per-user agent execution preferences. Today only `provider: 'anthropic'`
 * is supported — the field is stored anyway so a future "switch to OpenAI"
 * release doesn't need a schema migration.
 */
export type AgentLlmProvider = 'anthropic';

export type AgentSettings = {
  provider: AgentLlmProvider;
  tier: AgentModelTier;
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: 'anthropic',
  tier: DEFAULT_AGENT_MODEL_TIER,
};

function isTier(s: unknown): s is AgentModelTier {
  return typeof s === 'string' && (AGENT_MODEL_TIERS as readonly string[]).includes(s);
}

/**
 * Read a user's stored model tier. Returns the platform default when
 * the row is missing or the stored tier is no longer recognised — so
 * the chat surface stays usable even if the catalog evolved underneath
 * an existing user.
 */
export async function getAgentSettings(privyId: string): Promise<AgentSettings> {
  const db = getDb();
  await ensureAgentChatTables(db);
  const row = await db.execute({
    sql: `SELECT provider, model_tier FROM user_agent_settings WHERE privy_id = ? LIMIT 1`,
    args: [privyId],
  });
  const r = row.rows[0] as { provider?: string; model_tier?: string } | undefined;
  if (!r) return DEFAULT_AGENT_SETTINGS;
  return {
    provider: 'anthropic',
    tier: isTier(r.model_tier) ? r.model_tier : DEFAULT_AGENT_MODEL_TIER,
  };
}

export async function setAgentSettings(
  privyId: string,
  patch: { tier?: AgentModelTier; provider?: AgentLlmProvider },
): Promise<AgentSettings> {
  const current = await getAgentSettings(privyId);
  const next: AgentSettings = {
    provider: patch.provider ?? current.provider,
    tier: patch.tier ?? current.tier,
  };
  const db = getDb();
  await db.execute({
    sql: `
      INSERT INTO user_agent_settings (privy_id, provider, model_tier, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(privy_id) DO UPDATE SET
        provider = excluded.provider,
        model_tier = excluded.model_tier,
        updated_at = datetime('now')
    `,
    args: [privyId, next.provider, next.tier],
  });
  return next;
}

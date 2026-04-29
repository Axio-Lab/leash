import { decryptSecret } from '@leash/platform-auth/encryption';

import { getDb } from '@/lib/db';
import { getServerEnv } from '@/lib/env';
import { ensureAgentChatTables } from '@/lib/db-schema';

export type AnthropicKeyResolution = {
  apiKey: string;
  paidBy: 'user' | 'platform';
};

/**
 * BYOK → platform ANTHROPIC_API_KEY → throw if neither.
 */
export async function resolveAnthropicKey(privyId: string): Promise<AnthropicKeyResolution> {
  const env = getServerEnv();
  const db = getDb();
  await ensureAgentChatTables(db);

  const row = await db.execute({
    sql: `SELECT envelope FROM user_llm_keys WHERE privy_id = ? LIMIT 1`,
    args: [privyId],
  });

  const envelope = row.rows[0]
    ? String((row.rows[0] as Record<string, unknown>).envelope ?? '')
    : '';
  if (envelope.length > 0) {
    const key = decryptSecret(envelope, env.encryptionKey);
    return { apiKey: key, paidBy: 'user' };
  }

  if (!env.anthropicApiKey) {
    throw new Error(
      'No Anthropic API key configured (set ANTHROPIC_API_KEY or add a key in Settings → LLM).',
    );
  }
  return { apiKey: env.anthropicApiKey, paidBy: 'platform' };
}

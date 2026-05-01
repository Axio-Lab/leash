import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  DEFAULT_AGENT_SETTINGS,
  getAgentSettings,
  setAgentSettings,
} from '@/lib/agents/agent-settings';
import { resolveAgentModel } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

/**
 * `GET /api/llm/model` — current provider + model tier for the signed-in
 * user, plus the resolved Anthropic model id so the UI can show "running
 * `claude-sonnet-4-5`" without re-deriving it on the client.
 */
export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const settings = await getAgentSettings(session.privyId).catch(() => DEFAULT_AGENT_SETTINGS);
  return NextResponse.json({
    provider: settings.provider,
    tier: settings.tier,
    model: resolveAgentModel(settings.tier),
  });
}

const PutSchema = z.object({
  tier: z.enum(['haiku', 'sonnet', 'opus']),
});

/**
 * `PUT /api/llm/model` — change the user's tier. Future chat turns will
 * resolve to the model id the operator has wired for that tier (see
 * `LEASH_AGENT_MODEL_HAIKU/SONNET/OPUS`).
 */
export async function PUT(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_tier' }, { status: 400 });
  }
  const next = await setAgentSettings(session.privyId, { tier: parsed.data.tier });
  return NextResponse.json({
    ok: true,
    provider: next.provider,
    tier: next.tier,
    model: resolveAgentModel(next.tier),
  });
}

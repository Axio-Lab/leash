import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { automationContextKey, handleAutomationAssistantTurn } from '@/lib/automations/assistant';
import {
  createAutomationAssistantDeps,
  listConnectedToolkitsForOwner,
} from '@/lib/automations/server';
import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

const AssistantBodySchema = z.object({
  message: z.string().min(1).max(8000),
  pending_id: z.string().min(1).optional().nullable(),
  timezone: z.string().min(1).max(80).optional(),
});

async function resolvePrimaryAgentMint(privyId: string): Promise<string | null> {
  try {
    const env = getServerEnv();
    const res = await fetch(
      `${env.leashApiUrl}/v1/platform/agents?owner_privy_id=${encodeURIComponent(privyId)}`,
      { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: Array<{ mint?: string }> };
    const first = json.items?.find((a) => typeof a.mint === 'string' && a.mint.length > 0);
    return first?.mint ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = AssistantBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const agentMint = await resolvePrimaryAgentMint(session.privyId);
  const result = await handleAutomationAssistantTurn(createAutomationAssistantDeps(), {
    ownerPrivyId: session.privyId,
    message: parsed.data.message,
    agentMint,
    channel: 'web',
    contextKey: automationContextKey({ channel: 'web', ownerPrivyId: session.privyId }),
    pendingId: parsed.data.pending_id ?? null,
    timezone: parsed.data.timezone ?? 'UTC',
    toolkits: await listConnectedToolkitsForOwner(session.privyId),
    forceCreateOnUnknown: true,
  });

  return NextResponse.json(
    result ?? {
      handled: true,
      text: 'Tell me what the agent should automate, and I will draft it for review.',
    },
  );
}

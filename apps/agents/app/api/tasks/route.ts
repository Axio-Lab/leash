import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `POST /api/tasks` — enqueue a task for one of the user's agents.
 *
 * The user can only launch tasks against agents they own. We look up
 * the agent's owner via `apps/api`'s admin endpoint and reject if it
 * doesn't match the Privy session's privy id.
 */
export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as null | {
    agent_mint: string;
    prompt: string;
    budget_cap: string;
  };
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const env = getServerEnv();
  const agentRes = await fetch(
    `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(body.agent_mint)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  if (!agentRes.ok) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const agent = (await agentRes.json()) as { owner_privy_id: string };
  if (agent.owner_privy_id !== session.privyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const created = await fetch(`${env.leashApiUrl}/v1/platform/tasks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.leashApiAdminSecret}`,
    },
    body: JSON.stringify(body),
  });
  const text = await created.text();
  return new NextResponse(text, {
    status: created.status,
    headers: { 'content-type': created.headers.get('content-type') ?? 'application/json' },
  });
}

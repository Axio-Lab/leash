import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/agents/{mint}/tasks` — list tasks for an agent the
 * signed-in user owns.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { mint } = await params;
  const env = getServerEnv();
  const agentRes = await fetch(
    `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(mint)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  if (!agentRes.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const agent = (await agentRes.json()) as { owner_privy_id: string };
  if (agent.owner_privy_id !== session.privyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const upstream = await fetch(
    `${env.leashApiUrl}/v1/platform/tasks?agent_mint=${encodeURIComponent(mint)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

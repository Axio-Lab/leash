import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/tasks/{id}` — fetch a task summary (status, spent, etc.).
 * Used by the polling fallback when Redis isn't configured.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();
  const upstream = await fetch(`${env.leashApiUrl}/v1/platform/tasks/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'not_found' }, { status: upstream.status });
  }
  const task = (await upstream.json()) as { agent_mint: string };
  const agentRes = await fetch(
    `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(task.agent_mint)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  if (!agentRes.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const agent = (await agentRes.json()) as { owner_privy_id: string };
  if (agent.owner_privy_id !== session.privyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json(task);
}

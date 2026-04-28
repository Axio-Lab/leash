import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();
  // Verify ownership via the task → agent path.
  const taskRes = await fetch(`${env.leashApiUrl}/v1/platform/tasks/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
  });
  if (!taskRes.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const task = (await taskRes.json()) as { agent_mint: string };
  const agentRes = await fetch(
    `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(task.agent_mint)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  if (!agentRes.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const agent = (await agentRes.json()) as { owner_privy_id: string };
  if (agent.owner_privy_id !== session.privyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const upstream = await fetch(
    `${env.leashApiUrl}/v1/platform/tasks/${encodeURIComponent(id)}/activities`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

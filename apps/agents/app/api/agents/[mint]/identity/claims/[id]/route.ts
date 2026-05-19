import { NextResponse, type NextRequest } from 'next/server';

import { agentOwnerErrorResponse, loadAgentForOwner } from '@/lib/agent-ownership';
import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ mint: string; id: string }> },
) {
  const session = await requirePrivySession(_req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { mint, id } = await params;
  const env = getServerEnv();
  const ownership = await loadAgentForOwner({
    mint,
    privyId: session.privyId,
    leashApiUrl: env.leashApiUrl,
    adminSecret: env.leashApiAdminSecret,
  });
  if (!ownership.ok) return agentOwnerErrorResponse(ownership);

  try {
    const upstream = await fetch(
      `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(
        mint,
      )}/identity/claims/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
      },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: 'apps/api is offline; claim not revoked.' },
      { status: 503 },
    );
  }
}

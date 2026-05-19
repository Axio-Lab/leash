import { NextResponse, type NextRequest } from 'next/server';

import { agentOwnerErrorResponse, loadAgentForOwner } from '@/lib/agent-ownership';
import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

async function authorize(req: NextRequest, mint: string) {
  const session = await requirePrivySession(req);
  if (!session)
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    };
  const env = getServerEnv();
  const ownership = await loadAgentForOwner({
    mint,
    privyId: session.privyId,
    leashApiUrl: env.leashApiUrl,
    adminSecret: env.leashApiAdminSecret,
  });
  if (!ownership.ok) return { ok: false as const, response: agentOwnerErrorResponse(ownership) };
  return { ok: true as const, env };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const auth = await authorize(req, mint);
  if (!auth.ok) return auth.response;
  try {
    const upstream = await fetch(
      `${auth.env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(mint)}/identity/disclosures`,
      { headers: { authorization: `Bearer ${auth.env.leashApiAdminSecret}` } },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: 'apps/api is offline; disclosures not loaded.' },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const auth = await authorize(req, mint);
  if (!auth.ok) return auth.response;
  try {
    const upstream = await fetch(
      `${auth.env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(mint)}/identity/disclosures`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${auth.env.leashApiAdminSecret}`,
        },
        body: JSON.stringify(body),
      },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: 'apps/api is offline; disclosure not created.' },
      { status: 503 },
    );
  }
}

import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();
  const url = new URL(`${env.leashApiUrl}/v1/platform/automations/${encodeURIComponent(id)}/runs`);
  url.searchParams.set('owner_privy_id', session.privyId);
  const limit = req.nextUrl.searchParams.get('limit');
  if (limit) url.searchParams.set('limit', limit);

  try {
    const upstream = await fetch(url, {
      headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { items: [], warning: 'apps/api is unreachable — run history is unavailable.' },
      { status: 200 },
    );
  }
}

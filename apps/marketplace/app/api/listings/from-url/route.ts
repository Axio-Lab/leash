import { NextResponse, type NextRequest } from 'next/server';

import { leashMarketplace } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url || typeof body.url !== 'string') {
    return NextResponse.json(
      { error: 'invalid_request', message: 'url required' },
      { status: 400 },
    );
  }
  try {
    const r = await leashMarketplace.fromUrl(body.url);
    return NextResponse.json(r);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    return NextResponse.json(
      { error: (err as { code?: string }).code ?? 'upstream', message: (err as Error).message },
      { status: status === 422 ? 422 : 502 },
    );
  }
}

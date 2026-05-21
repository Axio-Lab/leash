import { NextResponse, type NextRequest } from 'next/server';

import { leashMarketplace } from '@/lib/leash';

/**
 * Public pay.sh/pay-skills detail proxy for marketplace capability pages.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fqn: string[] }> }) {
  const { fqn: segs } = await params;
  if (!Array.isArray(segs) || segs.length < 2 || segs.length > 3) {
    return NextResponse.json(
      { error: 'invalid_fqn', message: 'expected 2- or 3-segment FQN' },
      { status: 400 },
    );
  }

  try {
    const body = await leashMarketplace.paySkillsProvider(segs.join('/'));
    return NextResponse.json(body);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    return NextResponse.json(
      { error: (err as { code?: string }).code ?? 'upstream', message: (err as Error).message },
      { status: status === 404 ? 404 : 502 },
    );
  }
}

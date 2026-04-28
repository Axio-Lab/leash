import { NextResponse } from 'next/server';

import { leashMarketplace } from '@/lib/leash';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return NextResponse.json(await leashMarketplace.getListing(slug));
  } catch (err) {
    const status = (err as { status?: number }).status === 404 ? 404 : 502;
    return NextResponse.json({ error: 'upstream', message: (err as Error).message }, { status });
  }
}

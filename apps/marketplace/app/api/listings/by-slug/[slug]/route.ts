import { NextResponse } from 'next/server';

import { leashMarketplace } from '@/lib/leash';

/**
 * Single-listing fetch by URL slug (not the internal ULID `id`).
 *
 * Lives under `/api/listings/by-slug/…` so it does not collide at the
 * filesystem level with `/api/listings/[id]/rating` and
 * `/api/listings/[id]/reviews` — Next.js requires one dynamic segment name
 * per path level.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return NextResponse.json(await leashMarketplace.getListing(slug));
  } catch (err) {
    const status = (err as { status?: number }).status === 404 ? 404 : 502;
    return NextResponse.json({ error: 'upstream', message: (err as Error).message }, { status });
  }
}

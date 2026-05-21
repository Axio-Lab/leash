import { NextResponse, type NextRequest } from 'next/server';

import { leashMarketplace } from '@/lib/leash';

/**
 * Public marketplace discovery proxy.
 *
 * The marketplace browse page uses the shared Leash discover endpoint so
 * native Leash listings and Solana Foundation pay.sh/pay-skills providers
 * appear as one capability catalogue.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = new URLSearchParams();
  const query = url.searchParams.get('q')?.trim();
  if (query) q.set('capability', query);
  for (const key of ['max_price_usdc', 'pricing_type', 'limit']) {
    const value = url.searchParams.get(key);
    if (value) q.set(key, value);
  }
  const source = url.searchParams.get('source');
  if (source === 'leash' || source === 'pay-skills' || source === 'all') {
    q.set('source', source);
  }
  if (!q.has('source')) q.set('source', 'all');
  if (!q.has('limit')) q.set('limit', '75');

  try {
    const body = await leashMarketplace.discover(q);
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message, items: [] },
      { status: 502 },
    );
  }
}

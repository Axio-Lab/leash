import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { resolveSellerPayTo } from '@leash/seller-kit';
import { SOLANA_RPC } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Q = z.object({ asset: z.string().min(32) });

/**
 * Computes the Asset Signer PDA (seller `payTo`) for a Core asset mint, the
 * same way `createSeller` does internally.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const umi = createUmi(SOLANA_RPC).use(mplCore());
    const payTo = resolveSellerPayTo(umi, { asset: parsed.data.asset });
    return NextResponse.json({ asset: parsed.data.asset, payTo });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

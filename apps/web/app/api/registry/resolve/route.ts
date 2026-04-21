import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveByoUri } from '@leash/registry-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Q = z.object({ uri: z.string().url() });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const result = await resolveByoUri(parsed.data.uri);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}

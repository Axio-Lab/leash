import { NextResponse } from 'next/server';

import { getServerEnv } from '@/lib/env';

export async function GET() {
  const env = getServerEnv();
  try {
    const r = await fetch(`${env.leashApiUrl}/v1/stats/public`, {
      next: { revalidate: 30 },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return NextResponse.json(await r.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}

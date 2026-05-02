import { NextResponse } from 'next/server';
import { RUNNER_URL } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CORS-safe proxy onto `${RUNNER_URL}/endpoints`. The seller payment-link
 * builder hits this from the browser (Privy + same-origin), and the public
 * `/x/[id]` route uses `GET /endpoints/:id` server-side to hydrate the
 * x402 paywall.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = new URL('/endpoints', RUNNER_URL);
  for (const [k, v] of url.searchParams) target.searchParams.set(k, v);
  try {
    const res = await fetch(target, { cache: 'no-store' });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'runner_unreachable', detail: (err as Error).message, runner: RUNNER_URL },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  try {
    const res = await fetch(new URL('/endpoints', RUNNER_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'runner_unreachable', detail: (err as Error).message, runner: RUNNER_URL },
      { status: 502 },
    );
  }
}

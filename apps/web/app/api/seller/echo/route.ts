import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADER = 'x-payment';

/**
 * Minimal x402-shaped echo seller used by the playground. Mirrors
 * `@leash/seller-kit`'s `simpleX402Gate` (returns 402 unless the
 * `x-payment` header is present, then echoes the body). Inlined so we
 * don't have to spin up Hono inside Next API routes.
 */
export async function POST(req: Request) {
  if (!req.headers.get(HEADER)) {
    return NextResponse.json(
      {
        error: 'payment_required',
        protocol: 'x402-shaped',
        hint: 'send header `x-payment: mock` (the buyer kit does this automatically).',
      },
      { status: 402 },
    );
  }

  const text = await req.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON; that's fine */
  }
  return NextResponse.json({
    ok: true,
    echoed: parsed,
    receivedAt: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({
    info: 'POST here with `x-payment` header to receive an echo. 402 otherwise.',
  });
}

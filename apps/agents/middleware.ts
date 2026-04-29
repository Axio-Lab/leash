import { type NextRequest, NextResponse } from 'next/server';

/** Thread ids from createThread use crypto.randomUUID() */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Solana base58 public keys (mints) — redirect legacy /agents/:mint to /agents */
const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/dashboard') {
    return NextResponse.redirect(new URL('/agents', request.url));
  }

  const m = pathname.match(/^\/agents\/([^/]+)$/);
  if (!m) return NextResponse.next();
  const seg = m[1]!;
  if (seg === 'onboarding') return NextResponse.next();
  if (UUID_RE.test(seg)) return NextResponse.next();
  if (BASE58_PUBKEY.test(seg)) {
    return NextResponse.redirect(new URL('/agents', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard', '/agents/:segment'],
};

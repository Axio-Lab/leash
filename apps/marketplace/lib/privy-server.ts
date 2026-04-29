import type { NextRequest } from 'next/server';
import {
  verifyPrivyJwt,
  verifyPrivyJwtDetailed,
  type PrivySession,
  type PrivyVerifyResult,
} from '@leash/platform-auth';

import { getServerEnv } from './env';

function readToken(req: NextRequest): { token: string | null; via: 'header' | 'cookie' | 'none' } {
  const auth = req.headers.get('authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1]) return { token: m[1].trim(), via: 'header' };
  }
  const cookieToken = req.cookies.get('privy-token')?.value ?? null;
  if (cookieToken) return { token: cookieToken, via: 'cookie' };
  return { token: null, via: 'none' };
}

export async function requirePrivySession(req: NextRequest): Promise<PrivySession | null> {
  const env = getServerEnv();
  const opts = { appId: env.privyAppId, appSecret: env.privyAppSecret };
  // Prefer Bearer: `privy-token` may be a different/stale session value than
  // `getAccessToken()`; using cookie first caused 401 while the client sent a valid JWT.
  const auth = req.headers.get('authorization');
  const headerToken = (() => {
    if (!auth) return null;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1]!.trim() : null;
  })();
  if (headerToken) {
    const fromHeader = await verifyPrivyJwt(headerToken, opts);
    if (fromHeader) return fromHeader;
  }
  const cookieToken = req.cookies.get('privy-token')?.value;
  if (cookieToken) return verifyPrivyJwt(cookieToken, opts);
  return null;
}

/**
 * Detailed verification — returns the *reason* the JWT couldn't be
 * resolved into a session, so the BFF can return a recoverable error
 * (e.g. `no_solana_wallet`) instead of a flat 401.
 */
export async function resolvePrivySession(req: NextRequest): Promise<PrivyVerifyResult> {
  const env = getServerEnv();
  const opts = { appId: env.privyAppId, appSecret: env.privyAppSecret };
  const { token, via } = readToken(req);
  if (!token) {
    return { status: 'missing_token', session: null, reason: `no_token_via_${via}` };
  }
  const fromHeader = await verifyPrivyJwtDetailed(token, opts);
  if (fromHeader.status === 'ok') return fromHeader;
  // If the header token failed, try the cookie too (rare: Bearer present but
  // expired while a fresher cookie exists).
  if (via === 'header') {
    const cookieToken = req.cookies.get('privy-token')?.value;
    if (cookieToken && cookieToken !== token) {
      const fromCookie = await verifyPrivyJwtDetailed(cookieToken, opts);
      if (fromCookie.status === 'ok') return fromCookie;
      // Prefer the more informative result.
      if (fromHeader.status === 'invalid_token' && fromCookie.status !== 'invalid_token') {
        return fromCookie;
      }
    }
  }
  return fromHeader;
}

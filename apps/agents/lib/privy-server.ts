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
    if (m?.[1]) return { token: m[1].trim(), via: 'header' };
  }
  const cookieToken = req.cookies.get('privy-token')?.value ?? null;
  if (cookieToken) return { token: cookieToken, via: 'cookie' };
  return { token: null, via: 'none' };
}

/**
 * Resolve a Privy session from a Next request. Prefer Bearer header (fresh access token),
 * then `privy-token` cookie (older SDK behaviour).
 */
export async function requirePrivySession(req: NextRequest): Promise<PrivySession | null> {
  const env = getServerEnv();
  const opts = { appId: env.privyAppId, appSecret: env.privyAppSecret };
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
 * Detailed verification — returns the reason the JWT couldn't be resolved into a session.
 */
export async function resolvePrivySession(req: NextRequest): Promise<PrivyVerifyResult> {
  const env = getServerEnv();
  const opts = { appId: env.privyAppId, appSecret: env.privyAppSecret };
  const { token, via } = readToken(req);
  if (!token) {
    return { status: 'missing_token', session: null, reason: `no_token_via_${via}` };
  }
  const fromPrimary = await verifyPrivyJwtDetailed(token, opts);
  if (fromPrimary.status === 'ok') return fromPrimary;
  if (via === 'header') {
    const cookieToken = req.cookies.get('privy-token')?.value;
    if (cookieToken && cookieToken !== token) {
      const fromCookie = await verifyPrivyJwtDetailed(cookieToken, opts);
      if (fromCookie.status === 'ok') return fromCookie;
      if (fromPrimary.status === 'invalid_token' && fromCookie.status !== 'invalid_token') {
        return fromCookie;
      }
    }
  }
  return fromPrimary;
}

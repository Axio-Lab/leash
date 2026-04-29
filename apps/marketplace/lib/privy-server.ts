import type { NextRequest } from 'next/server';
import { verifyPrivyJwt, type PrivySession } from '@leash/platform-auth';

import { getServerEnv } from './env';

export async function requirePrivySession(req: NextRequest): Promise<PrivySession | null> {
  const env = getServerEnv();
  const opts = { appId: env.privyAppId, appSecret: env.privyAppSecret };
  const cookieToken = req.cookies.get('privy-token')?.value;
  const headerToken = (() => {
    const auth = req.headers.get('authorization');
    if (!auth) return null;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1]!.trim() : null;
  })();
  // Prefer Bearer: `privy-token` may be a different/stale session value than
  // `getAccessToken()`; using cookie first caused 401 while the client sent a valid JWT.
  if (headerToken) {
    const fromHeader = await verifyPrivyJwt(headerToken, opts);
    if (fromHeader) return fromHeader;
  }
  if (cookieToken) return verifyPrivyJwt(cookieToken, opts);
  return null;
}

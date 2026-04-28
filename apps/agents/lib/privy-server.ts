import type { NextRequest } from 'next/server';
import { verifyPrivyJwt, type PrivySession } from '@leash/platform-auth';

import { getServerEnv } from './env';

/**
 * Resolve a Privy session from a Next request. Looks at the
 * `privy-token` cookie first (set by the client SDK), then falls back to
 * the `Authorization: Bearer …` header for direct curl use.
 */
export async function requirePrivySession(req: NextRequest): Promise<PrivySession | null> {
  const env = getServerEnv();
  const cookieToken = req.cookies.get('privy-token')?.value;
  const headerToken = (() => {
    const auth = req.headers.get('authorization');
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? match[1]! : null;
  })();
  const token = cookieToken ?? headerToken;
  return verifyPrivyJwt(token, {
    appId: env.privyAppId,
    appSecret: env.privyAppSecret,
  });
}

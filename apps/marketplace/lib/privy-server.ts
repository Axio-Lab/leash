import type { NextRequest } from 'next/server';
import { verifyPrivyJwt, type PrivySession } from '@leash/platform-auth';

import { getServerEnv } from './env';

export async function requirePrivySession(req: NextRequest): Promise<PrivySession | null> {
  const env = getServerEnv();
  const cookieToken = req.cookies.get('privy-token')?.value;
  const headerToken = (() => {
    const auth = req.headers.get('authorization');
    if (!auth) return null;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1]! : null;
  })();
  return verifyPrivyJwt(cookieToken ?? headerToken, {
    appId: env.privyAppId,
    appSecret: env.privyAppSecret,
  });
}

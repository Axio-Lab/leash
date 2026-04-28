/**
 * Verify a Privy access token (JWT) and resolve it to a `PrivySession`
 * with the user's primary Solana wallet.
 *
 * The `@privy-io/server-auth` SDK fetches & caches Privy's JWKS, so
 * verification is offline after the first call.
 */

import { PrivyClient } from '@privy-io/server-auth';

export type PrivyVerifierOptions = {
  appId: string;
  appSecret: string;
};

export type PrivySession = {
  privyId: string;
  /** Solana base58 pubkey of the user's primary wallet (linked or embedded). */
  wallet: string;
  email: string | null;
};

let cachedClient: { key: string; client: PrivyClient } | null = null;

function getClient(opts: PrivyVerifierOptions): PrivyClient {
  const key = `${opts.appId}:${opts.appSecret.slice(0, 8)}`;
  if (cachedClient && cachedClient.key === key) return cachedClient.client;
  const client = new PrivyClient(opts.appId, opts.appSecret);
  cachedClient = { key, client };
  return client;
}

/**
 * Verify a token and return the user's session, or `null` if the token
 * is missing/invalid/expired. Never throws on auth failure — surfaces
 * call this from middleware that wants a clean 401 path.
 */
export async function verifyPrivyJwt(
  token: string | null | undefined,
  opts: PrivyVerifierOptions,
): Promise<PrivySession | null> {
  if (!token || token.length < 8) return null;
  try {
    const client = getClient(opts);
    const claims = await client.verifyAuthToken(token);
    const user = await client.getUserById(claims.userId);
    const solanaAccount = user.linkedAccounts.find(
      (a): a is typeof a & { address: string; chainType?: string } =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a as any).type === 'wallet' && (a as any).chainType === 'solana',
    );
    const wallet = solanaAccount?.address;
    if (!wallet) return null;
    const emailAccount = user.linkedAccounts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a): a is typeof a & { address: string } => (a as any).type === 'email',
    );
    return {
      privyId: claims.userId,
      wallet,
      email: emailAccount?.address ?? null,
    };
  } catch {
    return null;
  }
}

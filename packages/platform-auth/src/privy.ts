function pickType(account: unknown): string | undefined {
  if (!account || typeof account !== 'object') return undefined;
  const t = (account as Record<string, unknown>).type;
  return typeof t === 'string' ? t : undefined;
}

/** Privy REST payloads use `chain_type`; client types use `chainType`. */
function pickChainType(account: unknown): string | undefined {
  if (!account || typeof account !== 'object') return undefined;
  const a = account as Record<string, unknown>;
  const v = a.chainType ?? a.chain_type;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function pickAddress(account: unknown): string | undefined {
  if (!account || typeof account !== 'object') return undefined;
  const addr = (account as Record<string, unknown>).address;
  return typeof addr === 'string' ? addr : undefined;
}

function chainIsSolana(chain: string | undefined): boolean {
  if (!chain || typeof chain !== 'string') return false;
  const c = chain.toLowerCase();
  return c === 'solana' || c.startsWith('solana:');
}

/** Base58 pubkey shape — used when API omits `chainType` but the app is Solana-only. */
function looksLikeSolanaAddress(addr: string | undefined): boolean {
  if (!addr || typeof addr !== 'string') return false;
  if (addr.startsWith('0x')) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(addr);
}

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
    const accounts = user.linkedAccounts ?? [];
    const solanaAccount = accounts.find((a) => {
      if (pickType(a) !== 'wallet') return false;
      return chainIsSolana(pickChainType(a));
    });
    let wallet = pickAddress(solanaAccount);
    if (!wallet && user.wallet) {
      const ct = pickChainType(user.wallet);
      if (chainIsSolana(ct) || (!ct && looksLikeSolanaAddress(pickAddress(user.wallet)))) {
        wallet = pickAddress(user.wallet);
      }
    }
    if (!wallet) {
      const guess = accounts.find(
        (a) => pickType(a) === 'wallet' && looksLikeSolanaAddress(pickAddress(a)),
      );
      wallet = pickAddress(guess);
    }
    if (!wallet) return null;
    const emailAccount = accounts.find((a) => pickType(a) === 'email');
    const emailAddr = pickAddress(emailAccount);
    return {
      privyId: claims.userId,
      wallet,
      email: emailAddr ?? null,
    };
  } catch {
    return null;
  }
}

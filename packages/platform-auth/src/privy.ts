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
 * Structured verification result. Surfaces use this to distinguish
 * "JWT invalid" (401) from "JWT valid but the Privy user has no Solana
 * wallet" (recoverable: ask the user to connect or create one).
 */
export type PrivyVerifyStatus =
  | 'ok'
  | 'missing_token'
  | 'invalid_token'
  | 'lookup_failed'
  | 'no_solana_wallet';

/** Best-effort claims pulled out of the JWT *without* verification. */
export type DecodedJwtPeek = {
  /** Privy app id the token was issued for (`aud` claim). */
  audience?: string;
  /** Privy user id (`sub` claim). */
  subject?: string;
  /** Issuer (`iss` claim) — usually `privy.io`. */
  issuer?: string;
  expired?: boolean;
};

export type PrivyVerifyResult =
  | { status: 'ok'; session: PrivySession; jwt?: DecodedJwtPeek }
  | {
      status: Exclude<PrivyVerifyStatus, 'ok'>;
      session: null;
      privyId?: string;
      reason?: string;
      jwt?: DecodedJwtPeek;
    };

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64').toString('utf8');
}

/**
 * Decode the JWT without verifying it — purely for diagnostics. We use
 * this to surface "this token is for app A, but you configured app B"
 * which is by far the most common cause of `lookup_failed`.
 */
export function peekPrivyJwt(token: string | null | undefined): DecodedJwtPeek {
  if (!token || token.length < 8) return {};
  try {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) return {};
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const aud = payload.aud;
    const sub = payload.sub;
    const iss = payload.iss;
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
    return {
      audience: typeof aud === 'string' ? aud : undefined,
      subject: typeof sub === 'string' ? sub : undefined,
      issuer: typeof iss === 'string' ? iss : undefined,
      expired: typeof exp === 'number' ? exp * 1000 < Date.now() : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Verify a token and return a structured result. Never throws — surfaces
 * decide which status maps to which HTTP code.
 */
export async function verifyPrivyJwtDetailed(
  token: string | null | undefined,
  opts: PrivyVerifierOptions,
): Promise<PrivyVerifyResult> {
  if (!token || token.length < 8) {
    return { status: 'missing_token', session: null };
  }
  const jwt = peekPrivyJwt(token);
  // Catch the "JWT is for a different Privy app" case before we even
  // call the SDK — `verifyAuthToken` will throw with a generic JWS
  // error otherwise, which obscures the real cause.
  if (jwt.audience && opts.appId && jwt.audience !== opts.appId) {
    return {
      status: 'invalid_token',
      session: null,
      jwt,
      reason: `JWT audience (${jwt.audience}) does not match configured PRIVY_APP_ID (${opts.appId}). The browser is signed in to a different Privy app than the server is configured for.`,
    };
  }
  const client = getClient(opts);
  let claims: { userId: string };
  try {
    claims = await client.verifyAuthToken(token);
  } catch (e) {
    return {
      status: 'invalid_token',
      session: null,
      jwt,
      reason: e instanceof Error ? e.message : 'verifyAuthToken failed',
    };
  }
  let user;
  try {
    user = await client.getUserById(claims.userId);
  } catch (e) {
    return {
      status: 'lookup_failed',
      session: null,
      privyId: claims.userId,
      jwt,
      reason: e instanceof Error ? e.message : 'getUserById failed',
    };
  }
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
  if (!wallet) {
    return {
      status: 'no_solana_wallet',
      session: null,
      privyId: claims.userId,
      jwt,
      reason:
        'Privy user has no Solana wallet (linked or embedded). Ask the user to connect one or create an embedded Solana wallet.',
    };
  }
  const emailAccount = accounts.find((a) => pickType(a) === 'email');
  const emailAddr = pickAddress(emailAccount);
  return {
    status: 'ok',
    session: {
      privyId: claims.userId,
      wallet,
      email: emailAddr ?? null,
    },
    jwt,
  };
}

/**
 * Backwards-compatible wrapper: returns `null` on any failure.
 *
 * New code should prefer {@link verifyPrivyJwtDetailed} so it can show
 * recovery UI for the `no_solana_wallet` case instead of a flat 401.
 */
export async function verifyPrivyJwt(
  token: string | null | undefined,
  opts: PrivyVerifierOptions,
): Promise<PrivySession | null> {
  const r = await verifyPrivyJwtDetailed(token, opts);
  return r.status === 'ok' ? r.session : null;
}

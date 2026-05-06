import { NextResponse, type NextRequest } from 'next/server';
import { peekPrivyJwt, verifyPrivyJwtDetailed } from '@leashmarket/platform-auth';

import { getServerEnv } from '@/lib/env';

/**
 * Dev-only endpoint that surfaces every Privy auth diagnostic in one
 * place. Hit it from the browser at `/api/debug/privy` while signed
 * in to see exactly which app the JWT was issued for vs which app the
 * server is configured for.
 *
 * Disabled in production to avoid leaking app metadata.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let env;
  try {
    env = getServerEnv();
  } catch (e) {
    return NextResponse.json(
      { error: 'env_misconfigured', message: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }

  const auth = req.headers.get('authorization');
  const headerToken = (() => {
    if (!auth) return null;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1]!.trim() : null;
  })();
  const cookieToken = req.cookies.get('privy-token')?.value ?? null;
  const xPrivy = req.headers.get('x-privy-access-token')?.trim() || null;
  const candidate = headerToken ?? xPrivy ?? cookieToken;

  const peeked = peekPrivyJwt(candidate);
  const result = candidate
    ? await verifyPrivyJwtDetailed(candidate, {
        appId: env.privyAppId,
        appSecret: env.privyAppSecret,
      })
    : null;

  const audMatches = !!peeked.audience && !!env.privyAppId && peeked.audience === env.privyAppId;

  return NextResponse.json(
    {
      server: {
        privyAppId: env.privyAppId,
        privyAppSecretPrefix: env.privyAppSecret.slice(0, 18) + '…',
        nextPublicPrivyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? null,
        appIdsMatch: env.privyAppId === process.env.NEXT_PUBLIC_PRIVY_APP_ID,
      },
      request: {
        hasBearer: !!headerToken,
        hasXPrivyAccessToken: !!xPrivy,
        hasCookie: !!cookieToken,
        tokenSource: headerToken ? 'header' : xPrivy ? 'x-privy' : cookieToken ? 'cookie' : null,
      },
      jwt: peeked,
      audienceMatchesServer: audMatches,
      verify: result,
      verdict: verdict({
        hasToken: !!candidate,
        peeked,
        configuredAppId: env.privyAppId,
        nextPublicAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? null,
        result,
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

type VerifyResult = Awaited<ReturnType<typeof verifyPrivyJwtDetailed>> | null;

function verdict(args: {
  hasToken: boolean;
  peeked: ReturnType<typeof peekPrivyJwt>;
  configuredAppId: string;
  nextPublicAppId: string | null;
  result: VerifyResult;
}): { code: string; message: string; nextStep: string } {
  if (!args.hasToken) {
    return {
      code: 'missing_token',
      message: 'No JWT was sent on this request.',
      nextStep:
        'Sign in via Privy, then retry — the client should attach Authorization: Bearer <token>.',
    };
  }
  if (args.peeked.audience && args.peeked.audience !== args.configuredAppId) {
    return {
      code: 'app_id_mismatch',
      message: `JWT audience is ${args.peeked.audience} but server PRIVY_APP_ID is ${args.configuredAppId}.`,
      nextStep:
        'Either (a) update PRIVY_APP_ID + NEXT_PUBLIC_PRIVY_APP_ID to ' +
        args.peeked.audience +
        ' and use the matching PRIVY_APP_SECRET from that Privy app dashboard, or (b) sign out, switch the client to the right app, sign back in.',
    };
  }
  if (args.peeked.expired) {
    return {
      code: 'expired_token',
      message: 'JWT exp is in the past — the access token is stale.',
      nextStep:
        'Have the client call privy.getAccessToken() again (it auto-refreshes); reload the page to force a refresh.',
    };
  }
  if (args.nextPublicAppId && args.nextPublicAppId !== args.configuredAppId) {
    return {
      code: 'env_drift',
      message:
        'PRIVY_APP_ID and NEXT_PUBLIC_PRIVY_APP_ID disagree — the browser is signing in to one Privy app but the server is verifying against another.',
      nextStep:
        'Set both env vars to the SAME Privy app id, restart the dev server (NEXT_PUBLIC_* needs a restart to bake into the client bundle), and have the user log out + log back in.',
    };
  }
  if (args.result?.status === 'lookup_failed') {
    return {
      code: 'lookup_failed',
      message:
        'verifyAuthToken passed (so app ids and JWKS are correct) but getUserById failed. That call uses the app secret over HTTP Basic auth — a wrong / rotated secret is the only typical cause.',
      nextStep:
        'In the Privy dashboard for app ' +
        args.configuredAppId +
        ', regenerate the App Secret, paste it into PRIVY_APP_SECRET in apps/marketplace/.env, and restart the dev server.',
    };
  }
  if (args.result?.status === 'invalid_token') {
    return {
      code: 'invalid_token',
      message: args.result.reason ?? 'JWT signature did not verify.',
      nextStep:
        'Confirm both PRIVY_APP_ID and NEXT_PUBLIC_PRIVY_APP_ID point to the same Privy app, and that the user signed in *after* you set those values. Then sign out + sign back in to mint a fresh JWT.',
    };
  }
  if (args.result?.status === 'no_solana_wallet') {
    return {
      code: 'no_solana_wallet',
      message: 'JWT verifies and user exists, but the user has no Solana wallet linked.',
      nextStep:
        'Use the "Connect a Solana wallet" prompt in /creator (WalletGate) to create an embedded wallet or link an external one.',
    };
  }
  if (args.result?.status === 'ok') {
    return {
      code: 'ok',
      message: 'Auth is healthy — the BFF should be returning 200.',
      nextStep: 'No action needed.',
    };
  }
  return {
    code: 'unknown',
    message: 'Could not classify the failure.',
    nextStep: 'Inspect `verify.reason` in this response.',
  };
}

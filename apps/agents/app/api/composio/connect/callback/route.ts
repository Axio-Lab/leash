import { NextResponse, type NextRequest } from 'next/server';

import { getComposio } from '@/lib/composio';

export const runtime = 'nodejs';

/**
 * OAuth return handler — best-effort wait, then redirect back to Settings.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const id =
    url.searchParams.get('connected_account_id') ??
    url.searchParams.get('connection_request_id') ??
    url.searchParams.get('id');

  const composio = getComposio();
  if (composio && id) {
    try {
      await composio.connectedAccounts.waitForConnection(id, 45_000);
    } catch {
      /* Non-fatal — user may still land on connected state */
    }
  }

  return NextResponse.redirect(new URL('/settings/connections?status=connected', req.url));
}

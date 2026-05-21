import { NextResponse, type NextRequest } from 'next/server';

import { agentOwnerErrorResponse, loadAgentForOwner } from '@/lib/agent-ownership';
import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `PATCH /api/agents/[mint]` — patch the platform-side agent row.
 * Forwards `{ image_url?, services?, capabilities? }` to apps/api's
 * admin endpoint after Privy auth. Used post-mint to attach an image
 * URL once the upload finishes, or to add services later.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { mint } = await params;
  const body = (await req.json().catch(() => null)) as null | {
    image_url?: string | null;
    services?: Array<{ name: string; endpoint: string }>;
    budget?: { per_action: string; per_task: string; per_day: string };
    capabilities?: Array<{
      slug: string | null;
      endpoint: string;
      tools: string[];
      paid?: boolean;
    }>;
  };
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const env = getServerEnv();
  const ownership = await loadAgentForOwner({
    mint,
    privyId: session.privyId,
    leashApiUrl: env.leashApiUrl,
    adminSecret: env.leashApiAdminSecret,
  });
  if (!ownership.ok) return agentOwnerErrorResponse(ownership);

  try {
    const upstream = await fetch(
      `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(mint)}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.leashApiAdminSecret}`,
        },
        body: JSON.stringify(body),
      },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: 'apps/api is offline; agent not updated.' },
      { status: 503 },
    );
  }
}

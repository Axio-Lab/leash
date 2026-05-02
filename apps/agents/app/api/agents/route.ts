import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv, LEASH_AGENT_MODEL } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `POST /api/agents` — after the browser mints the MPL Core asset, the
 * client posts the resolved `{mint, treasury}` plus the agent draft and
 * the user's LLM provider key here. We forward to `apps/api`'s
 * admin-gated `/v1/platform/agents` endpoint, which encrypts the LLM
 * key and issues a service `lsh_*` for the agent-runtime.
 *
 * Platform chat flow sends `llm_provider: 'platform'` without `llm_api_key`.
 *
 * `GET /api/agents` returns every active agent owned by the signed-in
 * user (used by the dashboard listing).
 */
export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as null | {
    mint: string;
    treasury: string;
    name: string;
    description: string;
    image_url?: string | null;
    services?: Array<{ name: string; endpoint: string }>;
    network: 'solana-devnet' | 'solana-mainnet';
    model?: string;
    system_prompt?: string;
    capabilities?: Array<{
      slug: string | null;
      endpoint: string;
      tools: string[];
      paid?: boolean;
    }>;
    budget?: { per_action: string; per_task: string; per_day: string };
    llm_provider?: 'anthropic' | 'openai' | 'platform';
    llm_api_key?: string;
  };
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const env = getServerEnv();
  const llmProvider = body.llm_provider ?? 'platform';
  const payload: Record<string, unknown> = {
    mint: body.mint,
    treasury: body.treasury,
    owner_privy_id: session.privyId,
    owner_wallet: session.wallet,
    name: body.name,
    description: body.description ?? null,
    image_url: body.image_url ?? null,
    services: body.services ?? [],
    network: body.network,
    model: body.model ?? env.leashAgentModel ?? LEASH_AGENT_MODEL,
    system_prompt: body.system_prompt ?? `${body.name}. ${body.description}`,
    capabilities: body.capabilities ?? [],
    budget: body.budget ?? {
      per_action: '10',
      per_task: '50',
      per_day: '100',
    },
    llm_provider: llmProvider,
  };
  if (llmProvider !== 'platform' && body.llm_api_key) {
    payload.llm_api_key = body.llm_api_key;
  }
  const upstream = await fetch(`${env.leashApiUrl}/v1/platform/agents`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.leashApiAdminSecret}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const env = getServerEnv();
  try {
    const upstream = await fetch(
      `${env.leashApiUrl}/v1/platform/agents?owner_privy_id=${encodeURIComponent(session.privyId)}`,
      { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    // Keep the chat surface usable even when apps/api is offline locally.
    return NextResponse.json({
      items: [],
      warning: 'upstream_unreachable',
    });
  }
}

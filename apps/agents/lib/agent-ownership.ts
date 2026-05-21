import { NextResponse } from 'next/server';

export type OwnedAgent = {
  mint: string;
  owner_privy_id?: string;
  network?: string;
};

export type AgentOwnerLookupResult =
  | { ok: true; agent: OwnedAgent }
  | { ok: false; status: number; error: string; detail?: string };

export async function loadAgentForOwner(args: {
  mint: string;
  privyId: string;
  leashApiUrl: string;
  adminSecret: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<AgentOwnerLookupResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(
      `${args.leashApiUrl}/v1/platform/agents/${encodeURIComponent(args.mint)}`,
      { headers: { authorization: `Bearer ${args.adminSecret}` } },
    );
    if (res.status === 404) {
      return { ok: false, status: 404, error: 'agent_not_found' };
    }
    const json = (await res.json().catch(() => null)) as OwnedAgent | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: 'agent_lookup_failed',
        detail: json && 'error' in json ? String(json.error) : `HTTP ${res.status}`,
      };
    }
    if (!json || json.owner_privy_id !== args.privyId) {
      return { ok: false, status: 403, error: 'forbidden' };
    }
    return { ok: true, agent: json };
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'upstream_unreachable',
      detail: 'apps/api is offline; agent ownership could not be verified.',
    };
  }
}

export function agentOwnerErrorResponse(result: Exclude<AgentOwnerLookupResult, { ok: true }>) {
  return NextResponse.json(
    { error: result.error, ...(result.detail ? { detail: result.detail } : {}) },
    { status: result.status },
  );
}

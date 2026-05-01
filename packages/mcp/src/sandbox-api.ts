/**
 * Thin client for the public agent-onboarding endpoints
 * (`POST /v1/sandbox/agent`, `GET /v1/agents/self-register/info`).
 *
 * Lives here (not in `@leash/sdk`) because:
 *
 *   - The standalone MCP needs it before the SDK exists (the SDK is
 *     auto-generated in batch 10).
 *   - The shape is small + frozen by `apps/api`'s OpenAPI doc, so a
 *     hand-rolled client is the lowest-risk path for batch 4.
 *
 * Once `@leash/sdk` lands the standalone host will swap to it and
 * this file disappears.
 */

import type { SvmNetwork } from '@leash/mcp-core';

export type SandboxAgentRequest = {
  name?: string;
  description?: string;
};

export type SandboxAgentResponse = {
  mint: string;
  treasury: string;
  executive_pubkey: string;
  executive_secret_base58: string;
  network: SvmNetwork;
  tx_signatures: {
    sol_drip: string;
    mint: string;
    usdc_drip: string;
    /** Present on APIs >= the delegation fix (the buyer-kit needs this). */
    delegate?: string;
  };
  explorer_urls: {
    mint: string;
    sol_drip: string;
    usdc_drip: string;
    delegate?: string;
  };
  funded: {
    sol_lamports: string;
    usdc_atomic: string;
  };
  receipts_service: string;
};

/**
 * Provision a fully-funded devnet agent. Used by `leash_register_agent`
 * on the standalone MCP. This endpoint is intentionally rate-limited
 * (~5/IP/day) — fine for first-run onboarding, never for production
 * traffic.
 *
 * Throws on every non-201 path. Caller wraps in `try/catch` and
 * surfaces `message` to the LLM.
 */
export async function postSandboxAgent(args: {
  apiBaseUrl: string;
  body?: SandboxAgentRequest;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<SandboxAgentResponse> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const url = `${args.apiBaseUrl.replace(/\/+$/, '')}/v1/sandbox/agent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args.body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Leash API ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as SandboxAgentResponse;
}

/**
 * `LeashClient` — typed wrapper over the public Leash API.
 *
 * Two modes of authentication:
 *
 *   1. **Anonymous** — `new LeashClient({ baseUrl })`. Public reads
 *      (`discover`, `reputation`) work without credentials.
 *
 *   2. **Agent-signed** — pass `{ agentMint, executiveSecretBase58 }`.
 *      Authenticated calls (e.g. webhook management) get a fresh
 *      `X-Leash-Sig` header per request, signed with the executive
 *      keypair.
 *
 *   3. **Legacy API key** — pass `{ apiKey }`. Used until every
 *      endpoint accepts X-Leash-Sig; today this is what the chat
 *      product issues per user.
 *
 * Each method returns parsed JSON typed against `./types.ts`.
 * Network failures throw `LeashError` so callers can branch on the
 * `status` and `body` properties.
 */

import { signRequest } from './sign.js';
import type {
  AgentWebhook,
  AgentWebhookWithSecret,
  DiscoverResponse,
  ReceiptsResponse,
  ReputationSnapshot,
  SandboxAgentResponse,
  SvmNetwork,
} from './types.js';

export type LeashClientOptions = {
  baseUrl?: string;
  /**
   * Optional agent-signed auth bundle. When set, the client signs
   * every request that targets `/v1/agents/{mint}/...` with the
   * executive keypair (X-Leash-Sig). Public reads stay unsigned.
   */
  agentMint?: string;
  executiveSecretBase58?: string;
  /**
   * Legacy bearer-token auth. Used for endpoints that haven't
   * migrated to X-Leash-Sig yet (e.g. /v1/payment-links).
   */
  apiKey?: string;
  /** Hook for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch;
};

export class LeashError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class LeashClient {
  readonly baseUrl: string;
  private readonly agentMint?: string;
  private readonly executiveSecretBase58?: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: LeashClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.leash.market').replace(/\/+$/, '');
    if (opts.agentMint) this.agentMint = opts.agentMint;
    if (opts.executiveSecretBase58) this.executiveSecretBase58 = opts.executiveSecretBase58;
    if (opts.apiKey) this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  // ── public reads ──────────────────────────────────────────────────

  async discover(
    query: {
      capability?: string;
      max_price_usdc?: number;
      pricing_type?: 'free' | 'per_call' | 'variable';
      limit?: number;
    } = {},
  ): Promise<DiscoverResponse> {
    const params = new URLSearchParams();
    if (query.capability) params.set('capability', query.capability);
    if (query.max_price_usdc != null) params.set('max_price_usdc', String(query.max_price_usdc));
    if (query.pricing_type) params.set('pricing_type', query.pricing_type);
    if (query.limit) params.set('limit', String(query.limit));
    return this.requestJson<DiscoverResponse>(
      'GET',
      `/v1/discover${params.toString() ? `?${params}` : ''}`,
    );
  }

  async reputation(args: { agentMint: string; network?: SvmNetwork }): Promise<ReputationSnapshot> {
    const params = new URLSearchParams();
    if (args.network) params.set('network', args.network);
    return this.requestJson<ReputationSnapshot>(
      'GET',
      `/v1/agents/${encodeURIComponent(args.agentMint)}/reputation${params.toString() ? `?${params}` : ''}`,
    );
  }

  // ── sandbox onboarding (public) ──────────────────────────────────

  async sandbox(args: { name?: string } = {}): Promise<SandboxAgentResponse> {
    return this.requestJson<SandboxAgentResponse>('POST', '/v1/sandbox/agent', args);
  }

  // ── receipts (legacy API-key auth for now) ───────────────────────

  async receipts(args: {
    agentMint: string;
    direction?: 'spend' | 'earn';
    limit?: number;
  }): Promise<ReceiptsResponse> {
    if (!this.apiKey) {
      throw new LeashError(
        401,
        'receipts() requires an API key today. Pass `{ apiKey }` to LeashClient.',
        null,
      );
    }
    const params = new URLSearchParams();
    if (args.direction) params.set('kind', args.direction);
    if (args.limit) params.set('limit', String(args.limit));
    return this.requestJson<ReceiptsResponse>(
      'GET',
      `/v1/receipts/${encodeURIComponent(args.agentMint)}${params.toString() ? `?${params}` : ''}`,
    );
  }

  // ── agent webhooks (X-Leash-Sig auth) ────────────────────────────

  /**
   * `POST /v1/agents/{mint}/webhooks` — subscribe the active agent.
   * Returns the secret ONCE; persist it now or you'll have to upsert
   * to rotate. Called transparently with X-Leash-Sig auth.
   */
  async createWebhook(args: { url: string; events?: string[] }): Promise<AgentWebhookWithSecret> {
    this.requireAgentAuth();
    const path = `/v1/agents/${this.agentMint!}/webhooks`;
    return this.requestJson<AgentWebhookWithSecret>('POST', path, {
      url: args.url,
      ...(args.events ? { events: args.events } : {}),
    });
  }

  async listWebhooks(): Promise<{ items: AgentWebhook[] }> {
    this.requireAgentAuth();
    return this.requestJson<{ items: AgentWebhook[] }>(
      'GET',
      `/v1/agents/${this.agentMint!}/webhooks`,
    );
  }

  async deleteWebhook(id: string): Promise<{ ok: true }> {
    this.requireAgentAuth();
    return this.requestJson<{ ok: true }>(
      'DELETE',
      `/v1/agents/${this.agentMint!}/webhooks/${encodeURIComponent(id)}`,
    );
  }

  // ── internals ────────────────────────────────────────────────────

  private requireAgentAuth(): void {
    if (!this.agentMint || !this.executiveSecretBase58) {
      throw new LeashError(
        401,
        'this method requires an agent identity. Pass `{ agentMint, executiveSecretBase58 }` to LeashClient.',
        null,
      );
    }
  }

  /**
   * Fire one HTTP request, signing it with X-Leash-Sig when the
   * caller provided an agent identity AND the path is one of the
   * agent-scoped endpoints. Public/legacy paths skip signing and
   * fall back to the API-key bearer if available.
   */
  private async requestJson<T>(method: string, pathWithQuery: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${pathWithQuery}`;
    const bodyText = body == null ? undefined : JSON.stringify(body);

    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (bodyText) headers['content-type'] = 'application/json';

    const isAgentScoped =
      this.agentMint &&
      this.executiveSecretBase58 &&
      pathWithQuery.startsWith(`/v1/agents/${this.agentMint}`);
    if (isAgentScoped) {
      const sig = await signRequest({
        method,
        pathWithQuery,
        body: bodyText,
        agentMint: this.agentMint!,
        executiveSecretBase58: this.executiveSecretBase58!,
      });
      Object.assign(headers, sig);
    } else if (this.apiKey) {
      headers['authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await this.fetchImpl(url, {
      method,
      headers,
      ...(bodyText ? { body: bodyText } : {}),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const message =
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as Record<string, unknown>).message)
          : `HTTP ${res.status}`) ?? `HTTP ${res.status}`;
      throw new LeashError(res.status, message, parsed);
    }
    return parsed as T;
  }
}

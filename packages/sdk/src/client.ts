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
  AgentApiKey,
  AgentWebhook,
  AgentWebhookWithSecret,
  CreateAgentApiKeyInput,
  CreateAgentApiKeyResponse,
  DailyTransactionsResponse,
  DailyTxBucket,
  DiscoverResponse,
  IdentityCapabilityRequirement,
  IdentityDisclosureRead,
  IdentityVerificationDecision,
  IdentityVerificationDecisionRequest,
  IdentityVerificationThresholds,
  IdentityVerifyResponse,
  PaymentLink,
  PaymentLinkCreateInput,
  PaymentLinkPatchInput,
  PaymentLinksListResponse,
  PaySkillsProvider,
  PublicIdentityProfile,
  Receipt,
  RecordAgentInput,
  RecordAgentResponse,
  ReceiptsResponse,
  ReputationSnapshot,
  SvmNetwork,
  TransactionHistoryItem,
  TransactionHistoryResponse,
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
      /**
       * Restrict to a single catalogue:
       *   - `'leash'`: agents on the Leash marketplace.
       *   - `'pay-skills'`: providers in the Solana Foundation
       *     `pay-skills` registry.
       *   - `'all'` (default): merged.
       */
      source?: 'leash' | 'pay-skills' | 'all';
      limit?: number;
    } = {},
  ): Promise<DiscoverResponse> {
    const params = new URLSearchParams();
    if (query.capability) params.set('capability', query.capability);
    if (query.max_price_usdc != null) params.set('max_price_usdc', String(query.max_price_usdc));
    if (query.pricing_type) params.set('pricing_type', query.pricing_type);
    if (query.source) params.set('source', query.source);
    if (query.limit) params.set('limit', String(query.limit));
    return this.requestJson<DiscoverResponse>(
      'GET',
      `/v1/discover${params.toString() ? `?${params}` : ''}`,
    );
  }

  /**
   * Expand a `pay-skills` provider into its endpoint list.
   *
   * Use after {@link discover}: an item with `source === 'pay-skills'`
   * carries an `slug` equal to the provider FQN
   * (e.g. `agentmail/email`). Pass that here to get the absolute
   * endpoint URLs, methods, pricing, and supported stablecoins so the
   * agent can hand a URL to `buyer.fetch()` or `host.pay()`.
   *
   * Mirrors `pay skills endpoints <fqn>` from the pay.sh CLI.
   */
  async paySkillsProvider(fqn: string): Promise<PaySkillsProvider> {
    const trimmed = fqn.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed.includes('/')) {
      throw new LeashError(
        400,
        `pay-skills FQN must include at least one '/' (got "${fqn}")`,
        null,
      );
    }
    return this.requestJson<PaySkillsProvider>(
      'GET',
      `/v1/discover/pay-skills/${trimmed
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/')}`,
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

  async resolveIdentity(args: {
    mint?: string;
    handle?: string;
    domain?: string;
  }): Promise<PublicIdentityProfile> {
    const params = new URLSearchParams();
    if (args.mint) params.set('mint', args.mint);
    if (args.handle) params.set('handle', args.handle);
    if (args.domain) params.set('domain', args.domain);
    return this.requestJson<PublicIdentityProfile>('GET', `/v1/identity/resolve?${params}`);
  }

  async verifyIdentity(args: {
    mint?: string;
    handle?: string;
    domain?: string;
  }): Promise<IdentityVerifyResponse> {
    const params = new URLSearchParams();
    if (args.mint) params.set('mint', args.mint);
    if (args.handle) params.set('handle', args.handle);
    if (args.domain) params.set('domain', args.domain);
    return this.requestJson<IdentityVerifyResponse>('GET', `/v1/identity/verify?${params}`);
  }

  async verifyIdentityDecision(
    args: IdentityVerificationDecisionRequest,
  ): Promise<IdentityVerificationDecision> {
    return this.requestJson<IdentityVerificationDecision>('POST', '/v1/identity/verify', args);
  }

  async verifyCapabilitySeller(args: {
    selector: { mint?: string; handle?: string; domain?: string };
    capability: IdentityCapabilityRequirement;
    intent?: IdentityVerificationDecisionRequest['intent'];
    thresholds?: IdentityVerificationThresholds;
  }): Promise<IdentityVerificationDecision> {
    return this.verifyIdentityDecision({
      selector: args.selector,
      intent: args.intent ?? 'call_capability',
      capability: args.capability,
      ...(args.thresholds ? { thresholds: args.thresholds } : {}),
    });
  }

  async readIdentityDisclosure(token: string): Promise<IdentityDisclosureRead> {
    return this.requestJson<IdentityDisclosureRead>(
      'GET',
      `/v1/identity/disclosures/${encodeURIComponent(token)}`,
    );
  }

  // ── agent recording (public) ──────────────────────────────────────
  //
  // Agent provisioning is fully client-side now: the caller mints +
  // delegates locally (see `@leashmarket/mcp::mintAgentLocally`), then
  // POSTs the resulting asset here for the API to write the platform
  // row. Idempotent on `mint`. Works on both devnet and mainnet.

  async recordAgent(input: RecordAgentInput): Promise<RecordAgentResponse> {
    return this.requestJson<RecordAgentResponse>('POST', '/v1/agents/record', input);
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

  /**
   * `GET /v1/receipts/by-hash/{hash}` — direct lookup of a single
   * receipt by its deterministic `receipt_hash`. Network is bound to
   * the API key prefix; cross-network hashes return 404.
   *
   * The response is the same row shape `receipts()` emits, with the
   * full canonical ReceiptV1 in `raw`.
   */
  async getReceipt(hash: string): Promise<Receipt> {
    if (!this.apiKey) {
      throw new LeashError(
        401,
        'getReceipt() requires an API key today. Pass `{ apiKey }` to LeashClient.',
        null,
      );
    }
    return this.requestJson<Receipt>('GET', `/v1/receipts/by-hash/${encodeURIComponent(hash)}`);
  }

  /**
   * Walk the paginated `/v1/receipts/{agent}` feed and return every
   * receipt within the rolling `now - days` window. Stops early when
   * `limit` is hit (default 200, max 1000) or when a row falls out of
   * the window. Mirrors the `leash_transaction_history` MCP tool.
   *
   * Stables (USDC/USDG/USDT) are summed as USD 1:1 in the returned
   * totals; non-stable receipts get counted but excluded from the USD
   * math (`non_usd_count`).
   */
  async transactionHistory(args: {
    agentMint: string;
    days?: number;
    direction?: 'both' | 'outgoing' | 'incoming';
    limit?: number;
  }): Promise<TransactionHistoryResponse> {
    if (!this.apiKey) {
      throw new LeashError(
        401,
        'transactionHistory() requires an API key today. Pass `{ apiKey }` to LeashClient.',
        null,
      );
    }
    const days = clampInt(args.days ?? 7, 1, 90);
    const limit = clampInt(args.limit ?? 200, 1, 1000);
    const direction = args.direction ?? 'both';
    const cutoffMs = Date.now() - days * 86_400_000;
    const window = await this.fetchReceiptWindow({
      agent: args.agentMint,
      direction,
      limit,
      cutoffMs,
    });
    const totals = aggregateReceiptUsd(window.items);
    const network = (window.items[0]?.network ?? 'solana-devnet') as SvmNetwork;
    return {
      agent_mint: args.agentMint,
      network,
      range: {
        from: new Date(cutoffMs).toISOString(),
        to: new Date().toISOString(),
        days,
      },
      direction,
      count: window.items.length,
      truncated: window.truncated,
      total_sent_usd: totals.totalSentUsd,
      total_received_usd: totals.totalReceivedUsd,
      net_usd: totals.netUsd,
      sent_count: totals.sentCount,
      received_count: totals.receivedCount,
      non_usd_count: totals.nonUsdCount,
      items: window.items.map(
        (r): TransactionHistoryItem => ({
          receipt_hash: r.receipt_hash,
          direction: r.kind === 'spend' ? 'outgoing' : 'incoming',
          decision: r.decision,
          tx_signature: r.tx_sig,
          url: (r.raw?.request as { url?: string } | undefined)?.url ?? null,
          method: (r.raw?.request as { method?: string } | undefined)?.method ?? null,
          amount: (r.raw?.price as { amount?: string } | undefined)?.amount ?? null,
          currency: (r.raw?.price as { currency?: string } | undefined)?.currency ?? null,
          timestamp: r.ingested_at,
        }),
      ),
    };
  }

  /**
   * Same window as {@link transactionHistory} but folds the receipts
   * into per-day buckets keyed on UTC ingest date. Days with no
   * activity are emitted with zeros so the timeline is continuous.
   * Mirrors the `leash_daily_transactions` MCP tool.
   */
  async dailyTransactions(args: {
    agentMint: string;
    days?: number;
  }): Promise<DailyTransactionsResponse> {
    if (!this.apiKey) {
      throw new LeashError(
        401,
        'dailyTransactions() requires an API key today. Pass `{ apiKey }` to LeashClient.',
        null,
      );
    }
    const days = clampInt(args.days ?? 7, 1, 90);
    const cutoffMs = Date.now() - days * 86_400_000;
    const window = await this.fetchReceiptWindow({
      agent: args.agentMint,
      direction: 'both',
      limit: 1000,
      cutoffMs,
    });
    const totals = aggregateReceiptUsd(window.items);
    const buckets = bucketReceiptsByDay(window.items, days);
    const network = (window.items[0]?.network ?? 'solana-devnet') as SvmNetwork;
    return {
      agent_mint: args.agentMint,
      network,
      range: {
        from: new Date(cutoffMs).toISOString(),
        to: new Date().toISOString(),
        days,
      },
      daily: buckets,
      totals: {
        sent_count: totals.sentCount,
        sent_usd: totals.totalSentUsd,
        received_count: totals.receivedCount,
        received_usd: totals.totalReceivedUsd,
        net_usd: totals.netUsd,
        non_usd_count: totals.nonUsdCount,
      },
      truncated: window.truncated,
    };
  }

  /**
   * Walk the agent's receipts feed newest-first and stop once a row
   * falls before `cutoffMs`, the cap is hit, or the feed is
   * exhausted. Used by {@link transactionHistory} +
   * {@link dailyTransactions}.
   */
  private async fetchReceiptWindow(args: {
    agent: string;
    direction: 'both' | 'outgoing' | 'incoming';
    limit: number;
    cutoffMs: number;
  }): Promise<{ items: Receipt[]; truncated: boolean }> {
    const items: Receipt[] = [];
    let cursor: string | null = null;
    let truncated = false;
    const maxPages = 10;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (args.direction === 'outgoing') params.set('kind', 'spend');
      else if (args.direction === 'incoming') params.set('kind', 'earn');
      if (cursor) params.set('cursor', cursor);
      const json = await this.requestJson<ReceiptsResponse>(
        'GET',
        `/v1/receipts/${encodeURIComponent(args.agent)}?${params}`,
      );
      let stop = false;
      for (const r of json.items) {
        const ms = Date.parse(r.ingested_at);
        if (Number.isFinite(ms) && ms < args.cutoffMs) {
          stop = true;
          break;
        }
        items.push(r);
        if (items.length >= args.limit) {
          truncated = true;
          stop = true;
          break;
        }
      }
      if (stop || !json.next_cursor) break;
      cursor = json.next_cursor;
    }
    return { items, truncated };
  }

  // ── agent API keys (X-Leash-Sig auth) ────────────────────────────

  /**
   * `POST /v1/agents/{mint}/api-keys` — create an `agent` scoped API key
   * for the active agent. The plaintext is returned once; store it before
   * dropping the response.
   */
  async createAgentApiKey(input: CreateAgentApiKeyInput): Promise<CreateAgentApiKeyResponse> {
    this.requireAgentAuth();
    return this.requestJson<CreateAgentApiKeyResponse>(
      'POST',
      `/v1/agents/${this.agentMint!}/api-keys`,
      input,
    );
  }

  async listAgentApiKeys(
    query: { includeDisabled?: boolean; limit?: number } = {},
  ): Promise<{ items: AgentApiKey[] }> {
    this.requireAgentAuth();
    const params = new URLSearchParams();
    if (query.includeDisabled != null) {
      params.set('include_disabled', query.includeDisabled ? 'true' : 'false');
    }
    if (query.limit) params.set('limit', String(query.limit));
    return this.requestJson<{ items: AgentApiKey[] }>(
      'GET',
      `/v1/agents/${this.agentMint!}/api-keys${params.toString() ? `?${params}` : ''}`,
    );
  }

  async revokeAgentApiKey(id: string): Promise<{ key: AgentApiKey }> {
    this.requireAgentAuth();
    return this.requestJson<{ key: AgentApiKey }>(
      'POST',
      `/v1/agents/${this.agentMint!}/api-keys/${encodeURIComponent(id)}/disable`,
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

  // ── payment links (legacy API-key auth) ──────────────────────────
  //
  // These wrap `/v1/payment-links/*`. Today the API authenticates
  // them via the bearer-token API key, so callers must construct
  // `LeashClient` with `{ apiKey }`. We expose them here because they
  // are pure HTTP — no Solana signing — so they belong in the thin
  // client. To *pay* one programmatically, see `@leashmarket/buyer-kit` or
  // `@leashmarket/mcp`'s `pay()` host method (both sign locally).

  async createPaymentLink(input: PaymentLinkCreateInput): Promise<PaymentLink> {
    this.requireApiKey('createPaymentLink');
    return this.requestJson<PaymentLink>('POST', '/v1/payment-links', input);
  }

  async listPaymentLinks(
    query: {
      ownerAgent?: string;
      includeDisabled?: boolean;
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<PaymentLinksListResponse> {
    this.requireApiKey('listPaymentLinks');
    const params = new URLSearchParams();
    if (query.ownerAgent) params.set('owner_agent', query.ownerAgent);
    if (query.includeDisabled != null) {
      params.set('include_disabled', query.includeDisabled ? 'true' : 'false');
    }
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    return this.requestJson<PaymentLinksListResponse>(
      'GET',
      `/v1/payment-links${params.toString() ? `?${params}` : ''}`,
    );
  }

  async getPaymentLink(id: string): Promise<PaymentLink> {
    this.requireApiKey('getPaymentLink');
    return this.requestJson<PaymentLink>('GET', `/v1/payment-links/${encodeURIComponent(id)}`);
  }

  async updatePaymentLink(id: string, patch: PaymentLinkPatchInput): Promise<PaymentLink> {
    this.requireApiKey('updatePaymentLink');
    return this.requestJson<PaymentLink>(
      'PATCH',
      `/v1/payment-links/${encodeURIComponent(id)}`,
      patch,
    );
  }

  async deletePaymentLink(id: string): Promise<{ ok: true }> {
    this.requireApiKey('deletePaymentLink');
    return this.requestJson<{ ok: true }>('DELETE', `/v1/payment-links/${encodeURIComponent(id)}`);
  }

  // ── internals ────────────────────────────────────────────────────

  private requireApiKey(method: string): void {
    if (!this.apiKey) {
      throw new LeashError(
        401,
        `${method}() requires an API key today. Pass \`{ apiKey }\` to LeashClient.`,
        null,
      );
    }
  }

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

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (kept module-local — not exported)
// ────────────────────────────────────────────────────────────────────────────

const SDK_USD_STABLES = new Set(['USDC', 'USDG', 'USDT']);

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function aggregateReceiptUsd(items: Receipt[]): {
  sentCount: number;
  receivedCount: number;
  totalSentUsd: string;
  totalReceivedUsd: string;
  netUsd: string;
  nonUsdCount: number;
} {
  let sentCount = 0;
  let receivedCount = 0;
  let nonUsdCount = 0;
  let sentSum = 0;
  let receivedSum = 0;
  for (const r of items) {
    const price = r.raw?.price as { amount?: string; currency?: string } | undefined;
    const amt = parseFloat(price?.amount ?? '');
    const cur = (price?.currency ?? '').toUpperCase();
    if (r.kind === 'spend') sentCount++;
    else if (r.kind === 'earn') receivedCount++;
    if (!Number.isFinite(amt) || !cur) continue;
    if (!SDK_USD_STABLES.has(cur)) {
      nonUsdCount++;
      continue;
    }
    if (r.kind === 'spend') sentSum += amt;
    else if (r.kind === 'earn') receivedSum += amt;
  }
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  return {
    sentCount,
    receivedCount,
    nonUsdCount,
    totalSentUsd: round(sentSum).toString(),
    totalReceivedUsd: round(receivedSum).toString(),
    netUsd: round(receivedSum - sentSum).toString(),
  };
}

function bucketReceiptsByDay(items: Receipt[], days: number): DailyTxBucket[] {
  const map = new Map<
    string,
    { sentCount: number; sentSum: number; receivedCount: number; receivedSum: number }
  >();
  const today = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
  );
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    map.set(formatUtcDate(d), { sentCount: 0, sentSum: 0, receivedCount: 0, receivedSum: 0 });
  }
  for (const r of items) {
    const ingested = new Date(r.ingested_at);
    if (Number.isNaN(ingested.getTime())) continue;
    const key = formatUtcDate(ingested);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { sentCount: 0, sentSum: 0, receivedCount: 0, receivedSum: 0 };
      map.set(key, bucket);
    }
    if (r.kind === 'spend') bucket.sentCount++;
    else if (r.kind === 'earn') bucket.receivedCount++;
    const price = r.raw?.price as { amount?: string; currency?: string } | undefined;
    const amt = parseFloat(price?.amount ?? '');
    const cur = (price?.currency ?? '').toUpperCase();
    if (!Number.isFinite(amt) || !SDK_USD_STABLES.has(cur)) continue;
    if (r.kind === 'spend') bucket.sentSum += amt;
    else if (r.kind === 'earn') bucket.receivedSum += amt;
  }
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, b]) => ({
      date,
      sent_count: b.sentCount,
      sent_usd: round(b.sentSum).toString(),
      received_count: b.receivedCount,
      received_usd: round(b.receivedSum).toString(),
      net_usd: round(b.receivedSum - b.sentSum).toString(),
    }));
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

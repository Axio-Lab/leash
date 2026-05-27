/**
 * Typed wrapper around `apps/api`'s `/v1/admin/api-keys` endpoints (and
 * the `/v1/agents` / `/v1/tasks` / `/v1/marketplace/listings` endpoints
 * the Next.js BFFs need to hit). Holds the platform admin secret and
 * targets a configurable base URL so each surface can configure dev /
 * prod endpoints independently.
 *
 * The admin secret authenticates the BFF itself, NOT the end user — the
 * BFFs verify the Privy session first and translate it into authenticated
 * Leash admin calls scoped to the user's wallet.
 */

export type ApiScope = 'agents' | 'marketplace' | 'admin' | 'agent';

export type SvmNetwork = 'solana-devnet' | 'solana-mainnet';

export type LeashApiKeyRecord = {
  id: string;
  label: string;
  network: SvmNetwork;
  prefix: string;
  last4: string;
  owner_wallet: string | null;
  agent_mint: string | null;
  scopes: ApiScope[] | null;
  created_at: string;
  disabled_at: string | null;
};

export type CreateApiKeyArgs = {
  label: string;
  network: SvmNetwork;
  ownerWallet: string;
  scopes?: ApiScope[];
};

export class LeashAdminError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LeashAdminError';
  }
}

export type LeashAdminClient = {
  createApiKey(args: CreateApiKeyArgs): Promise<{ key: LeashApiKeyRecord; plaintext: string }>;
  listApiKeys(args: {
    network?: SvmNetwork;
    ownerWallet?: string;
    includeDisabled?: boolean;
  }): Promise<LeashApiKeyRecord[]>;
  disableApiKey(id: string): Promise<LeashApiKeyRecord>;
  /**
   * Decrypt and return the plaintext for an issued key. Only works for
   * keys minted on schema v10+ (the encrypted_plaintext column was
   * added then). Throws `LeashAdminError` 400 for legacy hash-only rows.
   */
  revealApiKey(id: string): Promise<string>;
};

type ClientOptions = {
  baseUrl: string;
  adminSecret: string;
  /** Override fetch (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
};

async function adminFetch<T>(opts: ClientOptions, path: string, init: RequestInit): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, '')}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${opts.adminSecret}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetchImpl(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: 'invalid_response', message: text };
    }
  }
  if (!res.ok) {
    const code =
      (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : null) ?? `http_${res.status}`;
    const message =
      (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : null) ?? res.statusText;
    throw new LeashAdminError(res.status, code, message);
  }
  return body as T;
}

export function createLeashAdminClient(opts: ClientOptions): LeashAdminClient {
  return {
    async createApiKey(args) {
      const body = await adminFetch<{ key: LeashApiKeyRecord; plaintext: string }>(
        opts,
        '/v1/admin/api-keys',
        {
          method: 'POST',
          body: JSON.stringify({
            label: args.label,
            network: args.network,
            owner_wallet: args.ownerWallet,
            ...(args.scopes && args.scopes.length > 0 ? { scopes: args.scopes } : {}),
          }),
        },
      );
      return body;
    },
    async listApiKeys(args) {
      const search = new URLSearchParams();
      if (args.network) search.set('network', args.network);
      if (args.ownerWallet) search.set('owner_wallet', args.ownerWallet);
      if (args.includeDisabled) search.set('include_disabled', 'true');
      const qs = search.toString();
      const body = await adminFetch<{ items: LeashApiKeyRecord[] }>(
        opts,
        `/v1/admin/api-keys${qs ? `?${qs}` : ''}`,
        { method: 'GET' },
      );
      return body.items;
    },
    async disableApiKey(id) {
      const body = await adminFetch<{ key: LeashApiKeyRecord }>(
        opts,
        `/v1/admin/api-keys/${encodeURIComponent(id)}/disable`,
        { method: 'POST' },
      );
      return body.key;
    },
    async revealApiKey(id) {
      const body = await adminFetch<{ plaintext: string }>(
        opts,
        `/v1/admin/api-keys/${encodeURIComponent(id)}/reveal`,
        { method: 'GET' },
      );
      return body.plaintext;
    },
  };
}

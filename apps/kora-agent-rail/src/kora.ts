export type FetchLike = typeof fetch;

export type KoraClientConfig = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  fetchImpl?: FetchLike;
};

export class KoraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = 'KoraApiError';
  }
}

type AuthKey = 'public' | 'secret';

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/^https?:\/\//.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') qs.set(key, String(value));
  }
  const rendered = qs.toString();
  return rendered ? `?${rendered}` : '';
}

export class KoraClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: KoraClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async getBalances(): Promise<unknown> {
    return this.request('GET', '/merchant/api/v1/balances');
  }

  async listBanks(countryCode: string): Promise<unknown> {
    return this.request(
      'GET',
      `/merchant/api/v1/misc/banks${queryString({ countryCode })}`,
      undefined,
      'public',
    );
  }

  async resolveBankAccount(input: unknown): Promise<unknown> {
    return this.request('POST', '/merchant/api/v1/misc/banks/resolve', input);
  }

  async createPayout(input: unknown): Promise<unknown> {
    return this.request('POST', '/merchant/api/v1/transactions/disburse', input);
  }

  async getPayoutStatus(transactionReference: string): Promise<unknown> {
    return this.request(
      'GET',
      `/merchant/api/v1/transactions/${encodeURIComponent(transactionReference)}`,
    );
  }

  async listPayouts(query: { limit?: number; currency?: string }): Promise<unknown> {
    return this.request('GET', `/merchant/api/v1/payouts${queryString(query)}`);
  }

  async createCheckout(input: unknown): Promise<unknown> {
    return this.request('POST', '/merchant/api/v1/charges/initialize', input);
  }

  async createVirtualAccount(input: unknown): Promise<unknown> {
    return this.request('POST', '/merchant/api/v1/virtual-bank-account', input);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    authKey: AuthKey = 'secret',
  ): Promise<unknown> {
    const token = authKey === 'public' ? this.config.publicKey : this.config.secretKey;
    if (!token) {
      throw new Error(`KORA_${authKey.toUpperCase()}_KEY is required for this Kora call`);
    }

    const res = await this.fetchImpl(joinUrl(this.config.baseUrl, path), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();
    const payload = text ? safeJson(text) : null;
    if (!res.ok) {
      throw new KoraApiError(`Kora API returned HTTP ${res.status}`, res.status, payload);
    }
    return payload;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export type PaymentLinkMetaEndpoint = {
  id: string;
  label: string;
  description: string | null;
  method: 'GET' | 'POST';
  url: string;
  price: string;
  /** Primary settlement currency (USDC by default). */
  currency: 'USDC' | 'USDT' | 'USDG';
  /**
   * Other stablecoins this endpoint accepts at the equivalent dollar
   * amount. Empty array when the endpoint is single-currency.
   */
  accepts_currencies: ReadonlyArray<'USDC' | 'USDT' | 'USDG'>;
  network: string;
  owner_agent: string;
  payTo: string | null;
  response: {
    status: number;
    mimeType: string;
    body_kind: 'json' | 'text';
  };
  hooks: {
    wrap_receipt: boolean;
    webhook_url: string | null;
  };
  created_at: string;
  updated_at: string;
};

export type PaymentLinkMeta = {
  ok: true;
  kind: 'leash.payment-link';
  docs?: string;
  note?: string;
  endpoint: PaymentLinkMetaEndpoint;
  facilitator?: string | null;
  explorer?: {
    agent?: string;
  };
};

/**
 * Inputs for {@link buildPaymentLinkMeta} — the producer-side builder used by
 * the Leash web app's `/x/<id>` route. Keeping the builder in `@leash/core`
 * means producer and consumer share one TypeScript shape, so any change to
 * the discovery contract becomes a typecheck error in both places.
 */
export type BuildPaymentLinkMetaInput = {
  endpoint: {
    id: string;
    label: string;
    description?: string | null;
    method: 'GET' | 'POST';
    price: string;
    /** Primary settlement currency. Defaults to `'USDC'` when omitted. */
    currency?: 'USDC' | 'USDT' | 'USDG';
    /** Additional accepted stablecoins. Defaults to `[]` when omitted. */
    accepts_currencies?: ReadonlyArray<'USDC' | 'USDT' | 'USDG'>;
    network: string;
    owner_agent: string;
    response: {
      status: number;
      mimeType: string;
      /** Pass `body` so we can derive `body_kind` from its runtime type. */
      body: unknown;
    };
    webhook_url?: string | null;
    wrap_receipt: boolean;
    created_at: string;
    updated_at: string;
  };
  /** Origin used to construct absolute URLs (e.g. `https://leash.app`). */
  origin: string;
  /** Asset Signer PDA the seller pays to (best-effort; can be null). */
  payTo: string | null;
  /** Optional facilitator URL recorded on the descriptor. */
  facilitator?: string | null;
  /** Optional docs URL exposed in the payload. */
  docsUrl?: string | null;
};

/**
 * Construct a typed {@link PaymentLinkMeta} payload to be returned by the
 * web app's `/x/<id>` GET discovery handler.
 *
 * This is the producer-side counterpart to {@link fetchPaymentLinkMeta}.
 * Both sides share the same TS types, so the wire contract stays in sync.
 */
export function buildPaymentLinkMeta(input: BuildPaymentLinkMetaInput): PaymentLinkMeta {
  const { endpoint, origin, payTo, facilitator, docsUrl } = input;
  const linkUrl = `${origin}/x/${endpoint.id}`;
  const meta: PaymentLinkMeta = {
    ok: true,
    kind: 'leash.payment-link',
    ...(docsUrl ? { docs: docsUrl } : {}),
    note: `Send ${endpoint.method} ${linkUrl} with an x402 client (e.g. @leash/buyer-kit) to pay this link. This GET surface is metadata-only — no payment is taken.`,
    endpoint: {
      id: endpoint.id,
      label: endpoint.label,
      description: endpoint.description ?? null,
      method: endpoint.method,
      url: linkUrl,
      price: endpoint.price,
      currency: endpoint.currency ?? 'USDC',
      accepts_currencies: endpoint.accepts_currencies ?? [],
      network: endpoint.network,
      owner_agent: endpoint.owner_agent,
      payTo,
      response: {
        status: endpoint.response.status,
        mimeType: endpoint.response.mimeType,
        body_kind: typeof endpoint.response.body === 'string' ? 'text' : 'json',
      },
      hooks: {
        wrap_receipt: endpoint.wrap_receipt,
        webhook_url: endpoint.webhook_url ?? null,
      },
      created_at: endpoint.created_at,
      updated_at: endpoint.updated_at,
    },
    ...(facilitator ? { facilitator } : {}),
    explorer: {
      agent: `${origin}/agents/${endpoint.owner_agent}`,
    },
  };
  return meta;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type FetchPaymentLinkMetaOptions = {
  /** Optional fetch override (defaults to global fetch). */
  fetch?: FetchLike;
  /** Extra init headers/timeouts/etc when dialing the discovery endpoint. */
  init?: RequestInit;
};

/**
 * Resolve a payment-link metadata descriptor from a Leash web host.
 *
 * This is a typed wrapper around the browser-friendly `GET /x/<id>` discovery
 * surface implemented by the playground app route (`apps/playground/app/x/[id]/route.ts`).
 *
 * Overloads:
 *   1) `fetchPaymentLinkMeta("https://host/x/abc123")`
 *   2) `fetchPaymentLinkMeta("https://host", "abc123")`
 *
 * Throws on non-2xx responses, invalid JSON, or payloads that don't match the
 * expected `kind: "leash.payment-link"` contract.
 */
export async function fetchPaymentLinkMeta(
  urlOrBase: string | URL,
  idOrOpts?: string | FetchPaymentLinkMetaOptions,
  maybeOpts?: FetchPaymentLinkMetaOptions,
): Promise<PaymentLinkMeta> {
  const id = typeof idOrOpts === 'string' ? idOrOpts : null;
  const opts = (typeof idOrOpts === 'string' ? maybeOpts : idOrOpts) ?? {};
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const target = buildTargetUrl(urlOrBase, id);
  const res = await fetchImpl(target, opts.init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `payment-link discovery failed (${res.status} ${res.statusText}) for ${target}: ${body || 'empty response'}`,
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(
      `payment-link discovery returned non-JSON for ${target}: ${(err as Error).message}`,
    );
  }
  return parsePaymentLinkMeta(json, target.toString());
}

function buildTargetUrl(urlOrBase: string | URL, id: string | null): URL {
  const raw = typeof urlOrBase === 'string' ? urlOrBase : urlOrBase.toString();
  const base = new URL(raw);
  if (!id) return base;
  const cleanBasePath = base.pathname.replace(/\/+$/, '');
  const encoded = encodeURIComponent(id);
  base.pathname = `${cleanBasePath}/x/${encoded}`;
  return base;
}

function parsePaymentLinkMeta(input: unknown, source: string): PaymentLinkMeta {
  if (!input || typeof input !== 'object') {
    throw new Error(`invalid payment-link metadata from ${source}: body is not an object`);
  }
  const obj = input as Record<string, unknown>;
  if (obj.ok !== true || obj.kind !== 'leash.payment-link') {
    throw new Error(
      `invalid payment-link metadata from ${source}: expected { ok: true, kind: "leash.payment-link" }`,
    );
  }

  const endpointRaw = obj.endpoint;
  if (!endpointRaw || typeof endpointRaw !== 'object') {
    throw new Error(`invalid payment-link metadata from ${source}: missing endpoint object`);
  }
  const endpointObj = endpointRaw as Record<string, unknown>;

  const method = endpointObj.method;
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(
      `invalid payment-link metadata from ${source}: endpoint.method must be GET|POST`,
    );
  }

  return {
    ok: true,
    kind: 'leash.payment-link',
    ...(typeof obj.docs === 'string' ? { docs: obj.docs } : {}),
    ...(typeof obj.note === 'string' ? { note: obj.note } : {}),
    endpoint: {
      id: asString(endpointObj.id, 'endpoint.id', source),
      label: asString(endpointObj.label, 'endpoint.label', source),
      description:
        endpointObj.description == null
          ? null
          : asString(endpointObj.description, 'endpoint.description', source),
      method,
      url: asString(endpointObj.url, 'endpoint.url', source),
      price: asString(endpointObj.price, 'endpoint.price', source),
      currency: parseCurrency(endpointObj.currency, 'endpoint.currency', source),
      accepts_currencies: parseAcceptsCurrencies(endpointObj.accepts_currencies, source),
      network: asString(endpointObj.network, 'endpoint.network', source),
      owner_agent: asString(endpointObj.owner_agent, 'endpoint.owner_agent', source),
      payTo:
        endpointObj.payTo == null ? null : asString(endpointObj.payTo, 'endpoint.payTo', source),
      response: parseResponse(endpointObj.response, source),
      hooks: parseHooks(endpointObj.hooks, source),
      created_at: asString(endpointObj.created_at, 'endpoint.created_at', source),
      updated_at: asString(endpointObj.updated_at, 'endpoint.updated_at', source),
    },
    ...(obj.facilitator == null
      ? {}
      : { facilitator: asString(obj.facilitator, 'facilitator', source) }),
    ...(obj.explorer && typeof obj.explorer === 'object'
      ? {
          explorer: {
            ...(typeof (obj.explorer as Record<string, unknown>).agent === 'string'
              ? { agent: (obj.explorer as Record<string, unknown>).agent as string }
              : {}),
          },
        }
      : {}),
  };
}

function parseResponse(input: unknown, source: string): PaymentLinkMetaEndpoint['response'] {
  if (!input || typeof input !== 'object') {
    throw new Error(`invalid payment-link metadata from ${source}: endpoint.response missing`);
  }
  const obj = input as Record<string, unknown>;
  const bodyKind = obj.body_kind;
  if (bodyKind !== 'json' && bodyKind !== 'text') {
    throw new Error(
      `invalid payment-link metadata from ${source}: endpoint.response.body_kind must be "json" or "text"`,
    );
  }
  const status = obj.status;
  if (typeof status !== 'number' || !Number.isInteger(status)) {
    throw new Error(
      `invalid payment-link metadata from ${source}: endpoint.response.status must be int`,
    );
  }
  return {
    status,
    mimeType: asString(obj.mimeType, 'endpoint.response.mimeType', source),
    body_kind: bodyKind,
  };
}

function parseHooks(input: unknown, source: string): PaymentLinkMetaEndpoint['hooks'] {
  if (!input || typeof input !== 'object') {
    throw new Error(`invalid payment-link metadata from ${source}: endpoint.hooks missing`);
  }
  const obj = input as Record<string, unknown>;
  return {
    wrap_receipt: asBoolean(obj.wrap_receipt, 'endpoint.hooks.wrap_receipt', source),
    webhook_url:
      obj.webhook_url == null
        ? null
        : asString(obj.webhook_url, 'endpoint.hooks.webhook_url', source),
  };
}

function asString(value: unknown, field: string, source: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `invalid payment-link metadata from ${source}: ${field} must be non-empty string`,
    );
  }
  return value;
}

function asBoolean(value: unknown, field: string, source: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`invalid payment-link metadata from ${source}: ${field} must be boolean`);
  }
  return value;
}

const KNOWN_DISCOVERY_CURRENCIES = ['USDC', 'USDT', 'USDG'] as const;
type DiscoveryCurrency = (typeof KNOWN_DISCOVERY_CURRENCIES)[number];

/**
 * Parse a currency tag from a discovery payload. Defaults to `'USDC'` when
 * the field is missing so older `/x/<id>` responses (pre multi-currency)
 * still parse cleanly.
 */
function parseCurrency(value: unknown, field: string, source: string): DiscoveryCurrency {
  if (value == null) return 'USDC';
  if (typeof value !== 'string') {
    throw new Error(`invalid payment-link metadata from ${source}: ${field} must be a string`);
  }
  const upper = value.toUpperCase();
  if (!(KNOWN_DISCOVERY_CURRENCIES as ReadonlyArray<string>).includes(upper)) {
    throw new Error(
      `invalid payment-link metadata from ${source}: ${field} must be one of ${KNOWN_DISCOVERY_CURRENCIES.join(', ')}`,
    );
  }
  return upper as DiscoveryCurrency;
}

function parseAcceptsCurrencies(value: unknown, source: string): ReadonlyArray<DiscoveryCurrency> {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      `invalid payment-link metadata from ${source}: endpoint.accepts_currencies must be an array`,
    );
  }
  return value.map((entry, idx) =>
    parseCurrency(entry, `endpoint.accepts_currencies[${idx}]`, source),
  );
}

/**
 * Server-side validator for `/.well-known/leash-mcp.json` manifests.
 * Same shape as `apps/agents/lib/mcp-manifest.ts` — kept here so the
 * marketplace ingestion path doesn't depend on the Next surface.
 */

import { invalidRequest } from './errors.js';

type ManifestPaymentProtocol = 'x402' | 'mpp';
type ManifestStableCurrency = 'USDC' | 'USDT' | 'USDG';

export type McpManifest = {
  name: string;
  slug: string | null;
  description: string;
  endpoint: string;
  category: string;
  endpoints: Array<{
    method: 'GET' | 'POST';
    url: string;
    description: string;
    pricing?: {
      type: 'free' | 'per_call' | 'variable';
      amount?: string;
      currency?: ManifestStableCurrency;
    };
    protocol?: ManifestPaymentProtocol[];
    supported_usd?: ManifestStableCurrency[];
  }>;
  pricing: {
    type: 'free' | 'per_call' | 'variable';
    amount?: string;
    currency?: ManifestStableCurrency;
  };
  docs_url?: string;
  free_tier?: number;
};

type ManifestPricing = McpManifest['pricing'];
type ManifestEndpoint = McpManifest['endpoints'][number];

export function validateManifest(input: unknown): McpManifest {
  if (!input || typeof input !== 'object') throw invalidRequest('manifest must be an object');
  const m = input as Record<string, unknown>;
  if (typeof m.name !== 'string' || m.name.length === 0)
    throw invalidRequest('manifest.name required');
  if (typeof m.description !== 'string' || m.description.length === 0)
    throw invalidRequest('manifest.description required');
  if (typeof m.endpoint !== 'string' || !/^https?:\/\//.test(m.endpoint))
    throw invalidRequest('manifest.endpoint required (http/https URL)');
  const slug = typeof m.slug === 'string' && m.slug.length > 0 ? m.slug : null;
  const category = typeof m.category === 'string' && m.category.length > 0 ? m.category : 'misc';
  if (!m.pricing || typeof m.pricing !== 'object')
    throw invalidRequest('manifest.pricing required');
  const manifestPricing = parseManifestPricing(m.pricing, 'manifest.pricing');
  const rawEndpoints = Array.isArray(m.endpoints) ? m.endpoints : [];
  const legacyTools = Array.isArray(m.tools) ? m.tools : [];
  const endpoints: ManifestEndpoint[] =
    rawEndpoints.length > 0
      ? rawEndpoints.map((e, i) => {
          if (!e || typeof e !== 'object')
            throw invalidRequest(`endpoints[${i}] must be an object`);
          const endpoint = e as Record<string, unknown>;
          const method = endpoint.method;
          if (method !== 'GET' && method !== 'POST')
            throw invalidRequest(`endpoints[${i}].method must be GET|POST`);
          if (typeof endpoint.url !== 'string' || !/^https?:\/\//.test(endpoint.url))
            throw invalidRequest(`endpoints[${i}].url required (http/https URL)`);
          if (typeof endpoint.description !== 'string')
            throw invalidRequest(`endpoints[${i}].description required`);
          return {
            method,
            url: endpoint.url,
            description: endpoint.description,
            ...(endpoint.pricing
              ? { pricing: parseManifestPricing(endpoint.pricing, `endpoints[${i}].pricing`) }
              : {}),
            ...(Array.isArray(endpoint.protocol)
              ? { protocol: endpoint.protocol.filter(isManifestPaymentProtocol) }
              : {}),
            ...(Array.isArray(endpoint.supported_usd)
              ? { supported_usd: endpoint.supported_usd.filter(isManifestStableCurrency) }
              : {}),
          };
        })
      : legacyTools.map((t, i) => {
          if (!t || typeof t !== 'object') throw invalidRequest(`tools[${i}] must be an object`);
          const tool = t as Record<string, unknown>;
          if (typeof tool.description !== 'string')
            throw invalidRequest(`tools[${i}].description required`);
          return {
            method: 'POST' as const,
            url: m.endpoint as string,
            description: tool.description,
            pricing: manifestPricing,
          };
        });
  if (endpoints.length === 0) throw invalidRequest('manifest.endpoints must be an array');
  return {
    name: m.name,
    slug,
    description: m.description,
    endpoint: m.endpoint,
    category,
    endpoints,
    pricing: manifestPricing,
    ...(typeof m.docs_url === 'string' ? { docs_url: m.docs_url } : {}),
    ...(typeof m.free_tier === 'number' ? { free_tier: m.free_tier } : {}),
  };
}

function parseManifestPricing(input: unknown, path: string): ManifestPricing {
  if (!input || typeof input !== 'object') throw invalidRequest(`${path} required`);
  const pricing = input as Record<string, unknown>;
  const type = pricing.type;
  if (type !== 'free' && type !== 'per_call' && type !== 'variable') {
    throw invalidRequest(`${path}.type must be free|per_call|variable, got ${String(type)}`);
  }
  const currency = pricing.currency;
  if (currency !== undefined && !isManifestStableCurrency(currency)) {
    throw invalidRequest(`${path}.currency must be USDC|USDT|USDG`);
  }
  return {
    type,
    ...(typeof pricing.amount === 'string' ? { amount: pricing.amount } : {}),
    ...(currency ? { currency } : {}),
  };
}

function isManifestPaymentProtocol(value: unknown): value is ManifestPaymentProtocol {
  return value === 'x402' || value === 'mpp';
}

function isManifestStableCurrency(value: unknown): value is ManifestStableCurrency {
  return value === 'USDC' || value === 'USDT' || value === 'USDG';
}

const MAX_BYTES = 256 * 1024;

export async function fetchAndValidateManifest(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<McpManifest> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw invalidRequest(`unsupported protocol: ${u.protocol}`);
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(u, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) throw invalidRequest(`manifest fetch failed: HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) {
      throw invalidRequest(`manifest too large (>${MAX_BYTES} bytes)`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalidRequest('manifest is not valid JSON');
    }
    return validateManifest(parsed);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-side validator for `/.well-known/leash-mcp.json` manifests.
 * Same shape as `apps/agents/lib/mcp-manifest.ts` — kept here so the
 * marketplace ingestion path doesn't depend on the Next surface.
 */

import { invalidRequest } from './errors.js';

export type McpManifest = {
  name: string;
  slug: string | null;
  description: string;
  endpoint: string;
  category: string;
  tools: Array<{ name: string; description: string; inputSchema?: unknown }>;
  pricing: { type: 'free' | 'per_call' | 'variable'; amount?: string; currency?: string };
  docs_url?: string;
  free_tier?: number;
};

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
  if (!Array.isArray(m.tools)) throw invalidRequest('manifest.tools must be an array');
  const tools = m.tools.map((t, i) => {
    if (!t || typeof t !== 'object') throw invalidRequest(`tools[${i}] must be an object`);
    const tool = t as Record<string, unknown>;
    if (typeof tool.name !== 'string') throw invalidRequest(`tools[${i}].name required`);
    if (typeof tool.description !== 'string')
      throw invalidRequest(`tools[${i}].description required`);
    return {
      name: tool.name,
      description: tool.description,
      ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
    };
  });
  if (!m.pricing || typeof m.pricing !== 'object')
    throw invalidRequest('manifest.pricing required');
  const pricing = m.pricing as Record<string, unknown>;
  const type = String(pricing.type);
  if (type !== 'free' && type !== 'per_call' && type !== 'variable') {
    throw invalidRequest(`manifest.pricing.type must be free|per_call|variable, got ${type}`);
  }
  return {
    name: m.name,
    slug,
    description: m.description,
    endpoint: m.endpoint,
    category,
    tools,
    pricing: {
      type,
      ...(typeof pricing.amount === 'string' ? { amount: pricing.amount } : {}),
      ...(typeof pricing.currency === 'string' ? { currency: pricing.currency } : {}),
    },
    ...(typeof m.docs_url === 'string' ? { docs_url: m.docs_url } : {}),
    ...(typeof m.free_tier === 'number' ? { free_tier: m.free_tier } : {}),
  };
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

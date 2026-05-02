/**
 * Fetch & validate a `/.well-known/leash-mcp.json` manifest.
 *
 * Schema (Phase 1 minimum):
 *   {
 *     "name": "USDC Airtime",
 *     "slug": "usdc-airtime",
 *     "description": "...",
 *     "endpoint": "https://airtime.example/mcp",
 *     "tools": [{ "name": "buy_airtime", "description": "...", "inputSchema": {...} }],
 *     "pricing": { "type": "per_call" | "free" | "variable", ... },
 *     "free_tier": 0
 *   }
 */

export type McpManifest = {
  name: string;
  slug: string | null;
  description: string;
  endpoint: string;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  pricing: { type: string; amount?: string; currency?: string };
  free_tier?: number;
};

const MAX_BYTES = 256 * 1024;

export async function fetchMcpManifest(url: string): Promise<McpManifest> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(`unsupported protocol: ${u.protocol}`);
  }
  const res = await fetch(u, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) throw new Error(`manifest must be JSON, got ${ct || 'unknown'}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) {
    throw new Error(`manifest too large (>${MAX_BYTES} bytes)`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('manifest is not valid JSON');
  }
  return validateManifest(parsed);
}

export function validateManifest(input: unknown): McpManifest {
  if (!input || typeof input !== 'object') throw new Error('manifest must be an object');
  const m = input as Record<string, unknown>;
  if (typeof m.name !== 'string' || m.name.length === 0) throw new Error('manifest.name required');
  if (typeof m.description !== 'string' || m.description.length === 0)
    throw new Error('manifest.description required');
  if (typeof m.endpoint !== 'string' || !/^https?:\/\//.test(m.endpoint))
    throw new Error('manifest.endpoint required (http/https URL)');
  const slug = typeof m.slug === 'string' && m.slug.length > 0 ? m.slug : null;
  const toolsRaw = m.tools;
  if (!Array.isArray(toolsRaw)) throw new Error('manifest.tools must be an array');
  const tools = toolsRaw.map((t, i) => {
    if (!t || typeof t !== 'object') throw new Error(`tools[${i}] must be an object`);
    const tool = t as Record<string, unknown>;
    if (typeof tool.name !== 'string') throw new Error(`tools[${i}].name required`);
    if (typeof tool.description !== 'string') throw new Error(`tools[${i}].description required`);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? {},
    };
  });
  const pricingRaw = m.pricing;
  if (!pricingRaw || typeof pricingRaw !== 'object') throw new Error('manifest.pricing required');
  const pricing = pricingRaw as Record<string, unknown>;
  if (typeof pricing.type !== 'string') throw new Error('manifest.pricing.type required');
  return {
    name: m.name,
    slug,
    description: m.description,
    endpoint: m.endpoint,
    tools,
    pricing: {
      type: pricing.type,
      ...(typeof pricing.amount === 'string' ? { amount: pricing.amount } : {}),
      ...(typeof pricing.currency === 'string' ? { currency: pricing.currency } : {}),
    },
    ...(typeof m.free_tier === 'number' ? { free_tier: m.free_tier } : {}),
  };
}

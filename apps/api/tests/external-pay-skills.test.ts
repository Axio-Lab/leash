import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetPaySkillsCacheForTests,
  getPaySkillsProvider,
  providerToItem,
  searchPaySkills,
  type PaySkillsIndex,
} from '../src/external/pay-skills.js';

const SAMPLE_INDEX: PaySkillsIndex = {
  version: 2,
  generated_at: '2026-05-05T00:00:00Z',
  base_url: 'https://storage.googleapis.com/pay-skills/v1',
  provider_count: 4,
  providers: [
    {
      fqn: 'agentmail/email',
      title: 'AgentMail',
      description: 'Email inboxes for agents',
      use_case: 'Send and receive email programmatically',
      category: 'messaging',
      service_url: 'https://x402.api.agentmail.to',
      endpoint_count: 83,
      has_metering: true,
      has_free_tier: true,
      min_price_usd: 0.0,
      max_price_usd: 10.0,
    },
    {
      fqn: 'merit-systems/stablecrypto/market-data',
      title: 'StableCrypto',
      description: 'Crypto market data — prices, TVL, on-chain stats',
      use_case: 'Crypto research and analytics',
      category: 'finance',
      service_url: 'https://stablecrypto.dev',
      endpoint_count: 105,
      has_metering: true,
      has_free_tier: false,
      min_price_usd: 0.01,
      max_price_usd: 0.01,
    },
    {
      fqn: 'crushrewards/pricing',
      title: 'Crush Rewards',
      description: 'Retail price tracking',
      use_case: 'Compare retail prices across major retailers',
      category: 'shopping',
      service_url: 'https://api.crushrewards.dev',
      endpoint_count: 13,
      has_metering: false,
      has_free_tier: true,
      min_price_usd: 0.0,
      max_price_usd: 0.0,
    },
    {
      fqn: 'foo/bar',
      title: 'Foo Bar',
      description: 'A premium-priced API',
      use_case: 'Premium use case',
      category: 'compute',
      service_url: 'https://foo.example',
      endpoint_count: 1,
      has_metering: false,
      has_free_tier: false,
      min_price_usd: 5.0,
      max_price_usd: 5.0,
    },
  ],
};

function fetchOk(payload: unknown): typeof globalThis.fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
  ) as unknown as typeof globalThis.fetch;
}

function fetchFail(): typeof globalThis.fetch {
  return vi.fn(async () => {
    throw new Error('network down');
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  _resetPaySkillsCacheForTests();
});

afterEach(() => {
  _resetPaySkillsCacheForTests();
});

describe('providerToItem', () => {
  it('maps a free provider to pricing_type=free', () => {
    const p = SAMPLE_INDEX.providers[2]!; // Crush Rewards
    const item = providerToItem(p);
    expect(item.source).toBe('pay-skills');
    expect(item.pricing_type).toBe('free');
    expect(item.price_usdc).toBeNull();
    expect(item.slug).toBe('crushrewards/pricing');
    expect(item.url).toBe('https://api.crushrewards.dev');
    expect(item.seller_wallet).toBeNull();
    expect(item.seller_agent_mint).toBeNull();
    expect(item.tools).toEqual([]);
    expect(item.tags).toEqual(['shopping']);
  });

  it('maps a fixed-price provider to pricing_type=per_call', () => {
    const p = SAMPLE_INDEX.providers[1]!; // StableCrypto, 0.01 flat
    const item = providerToItem(p);
    expect(item.pricing_type).toBe('per_call');
    expect(item.price_usdc).toBe('0.01');
  });

  it('maps a variable-priced provider to pricing_type=variable', () => {
    const p = SAMPLE_INDEX.providers[0]!; // AgentMail, 0..10
    const item = providerToItem(p);
    expect(item.pricing_type).toBe('variable');
    expect(item.price_usdc).toBeNull();
  });
});

describe('searchPaySkills', () => {
  it('returns all providers normalised when no filters given', async () => {
    const items = await searchPaySkills({ fetchImpl: fetchOk(SAMPLE_INDEX) });
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.source === 'pay-skills')).toBe(true);
  });

  it('filters by capability across title/description/use_case/category', async () => {
    const items = await searchPaySkills({
      capability: 'email',
      fetchImpl: fetchOk(SAMPLE_INDEX),
    });
    expect(items.map((i) => i.slug)).toEqual(['agentmail/email']);
  });

  it('capability match is case-insensitive', async () => {
    const items = await searchPaySkills({
      capability: 'CRYPTO',
      fetchImpl: fetchOk(SAMPLE_INDEX),
    });
    expect(items.map((i) => i.slug)).toEqual(['merit-systems/stablecrypto/market-data']);
  });

  it('filters by pricing_type=free', async () => {
    const items = await searchPaySkills({
      pricing_type: 'free',
      fetchImpl: fetchOk(SAMPLE_INDEX),
    });
    expect(items.map((i) => i.slug)).toEqual(['crushrewards/pricing']);
  });

  it('respects max_price_usdc on per_call entries', async () => {
    const items = await searchPaySkills({
      max_price_usdc: 0.5,
      fetchImpl: fetchOk(SAMPLE_INDEX),
    });
    // Excludes foo/bar (5 USD); includes free + variable + cheap per_call.
    expect(items.map((i) => i.slug).sort()).toEqual([
      'agentmail/email',
      'crushrewards/pricing',
      'merit-systems/stablecrypto/market-data',
    ]);
  });

  it('caps the result count via limit', async () => {
    const items = await searchPaySkills({
      limit: 2,
      fetchImpl: fetchOk(SAMPLE_INDEX),
    });
    expect(items).toHaveLength(2);
  });

  it('returns [] on fetch failure with no cached fallback', async () => {
    const items = await searchPaySkills({ fetchImpl: fetchFail() });
    expect(items).toEqual([]);
  });

  it('serves stale cache when a refresh fails', async () => {
    // Prime the cache with a successful fetch.
    const ok = fetchOk(SAMPLE_INDEX);
    const first = await searchPaySkills({ fetchImpl: ok });
    expect(first).toHaveLength(4);
    expect(ok).toHaveBeenCalledTimes(1);

    // A second call within TTL must NOT hit the network at all
    // (TTL window is 10 min by default).
    const second = await searchPaySkills({ fetchImpl: ok });
    expect(second).toHaveLength(4);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed indexes', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ wrong: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const items = await searchPaySkills({ fetchImpl });
    expect(items).toEqual([]);
  });
});

describe('getPaySkillsProvider', () => {
  const SAMPLE_PROVIDER = {
    fqn: 'agentmail/email',
    name: 'email',
    operator: 'agentmail',
    title: 'AgentMail',
    description: 'Email inboxes for agents',
    use_case: 'Send and receive email programmatically',
    category: 'messaging',
    service_url: 'https://x402.api.agentmail.to',
    version: '1.0.0',
    endpoints: [
      {
        method: 'GET',
        path: 'v0/domains',
        description: 'List Domains',
        resource: 'subpackage_domains',
        pricing: { mode: 'flat', dimensions: [{ tiers: [{ price_usd: 0.0 }] }] },
        protocol: ['x402'],
        supported_usd: ['USDC'],
        probe_status: 'ok',
        probe_description: 'Service: AgentMail API',
      },
      {
        method: 'POST',
        path: 'v0/inboxes',
        description: 'Create Inbox',
        protocol: ['x402'],
        supported_usd: ['USDC', 'USDT'],
        probe_status: 'ok',
      },
    ],
  };

  it('fetches and normalises a provider, joining service_url + path', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(SAMPLE_PROVIDER), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = await getPaySkillsProvider({ fqn: 'agentmail/email', fetchImpl });
    expect(provider).not.toBeNull();
    expect(provider!.fqn).toBe('agentmail/email');
    expect(provider!.title).toBe('AgentMail');
    expect(provider!.endpoints).toHaveLength(2);
    expect(provider!.endpoint_urls).toEqual([
      'https://x402.api.agentmail.to/v0/domains',
      'https://x402.api.agentmail.to/v0/inboxes',
    ]);
    expect(provider!.endpoints[0]!.protocol).toEqual(['x402']);
    expect(provider!.endpoints[1]!.supported_usd).toEqual(['USDC', 'USDT']);
  });

  it('returns null on 404 (provider not in catalog)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = await getPaySkillsProvider({ fqn: 'nope/missing', fetchImpl });
    expect(provider).toBeNull();
  });

  it('returns null on transient fetch failure with no cached fallback', async () => {
    const provider = await getPaySkillsProvider({
      fqn: 'agentmail/email',
      fetchImpl: fetchFail(),
    });
    expect(provider).toBeNull();
  });

  it('caches per-FQN within TTL', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(SAMPLE_PROVIDER), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const a = await getPaySkillsProvider({ fqn: 'agentmail/email', fetchImpl });
    const b = await getPaySkillsProvider({ fqn: 'agentmail/email', fetchImpl });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed provider responses', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ random: 'shape' }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const provider = await getPaySkillsProvider({ fqn: 'malformed/one', fetchImpl });
    expect(provider).toBeNull();
  });
});

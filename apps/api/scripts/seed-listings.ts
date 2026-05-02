/**
 * Seed three demo marketplace listings so `leash.market/browse` and the
 * agent helper search both return real results during the demo.
 *
 * Usage:
 *   pnpm --filter @leash/api db:migrate    # ensure schema v9
 *   pnpm --filter @leash/api seed:listings
 *
 * Env: LEASH_DB_URL [+ LEASH_DB_AUTH_TOKEN] OR LEASH_API_DB_URL[+TOKEN].
 *
 * Idempotent: skips slugs that already exist.
 */

import { createClient } from '@libsql/client';

import { createListing, getListingBySlug, setListingStatus } from '../src/storage/listings.js';

type Pricing = { type: 'free' | 'per_call'; amount?: string; currency?: string };
type Tool = { name: string; description: string };

const DEMO_OWNER_PRIVY_ID = process.env.LEASH_SEED_OWNER_PRIVY ?? 'demo-seed-owner';
const DEMO_OWNER_WALLET = process.env.LEASH_SEED_OWNER_WALLET ?? '11111111111111111111111111111111';

type Seed = {
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricing: Pricing;
  tools: Tool[];
  docsUrl?: string;
  freeTier?: number;
};

const seeds: Seed[] = [
  {
    slug: 'premium-search',
    name: 'Premium Web Search',
    description: '50M curated sources with citations. Built for agents that need fresh facts.',
    category: 'search',
    endpoint: 'https://search.demo.leash.market/mcp',
    pricing: { type: 'per_call', amount: '0.001', currency: 'USDC' },
    tools: [
      {
        name: 'search',
        description: 'Returns the top results for a query, with citations.',
      },
      {
        name: 'fetch_url',
        description: 'Fetch a single URL and return cleaned markdown.',
      },
    ],
    docsUrl: 'https://docs.demo.leash.market/search',
    freeTier: 100,
  },
  {
    slug: 'data-fetch',
    name: 'Data Fetch',
    description: 'Read-only adapter over public REST APIs (weather, FX, price oracles). Free tier.',
    category: 'data',
    endpoint: 'https://data.demo.leash.market/mcp',
    pricing: { type: 'free' },
    tools: [
      { name: 'weather_now', description: 'Current weather for a coordinate.' },
      { name: 'fx_rate', description: 'Spot FX rate for a currency pair.' },
    ],
    docsUrl: 'https://docs.demo.leash.market/data',
  },
  {
    slug: 'airtime-payouts',
    name: 'Airtime Payouts',
    description: 'Send airtime topups to mobile numbers in 80+ countries. Settles instantly.',
    category: 'payments',
    endpoint: 'https://airtime.demo.leash.market/mcp',
    pricing: { type: 'per_call', amount: '0.50', currency: 'USDC' },
    tools: [
      {
        name: 'send_airtime',
        description: 'Send an airtime credit to a phone number. Returns a receipt id.',
      },
      {
        name: 'list_carriers',
        description: 'List supported carriers for a country code.',
      },
    ],
    docsUrl: 'https://docs.demo.leash.market/airtime',
  },
];

const url = (process.env.LEASH_DB_URL || process.env.LEASH_API_DB_URL || '').trim();
const authToken = (
  process.env.LEASH_DB_AUTH_TOKEN ||
  process.env.LEASH_API_DB_AUTH_TOKEN ||
  ''
).trim();

if (!url) {
  throw new Error('Set LEASH_DB_URL or LEASH_API_DB_URL');
}

const db = createClient({ url, ...(authToken ? { authToken } : {}) });

let created = 0;
let skipped = 0;

for (const s of seeds) {
  const existing = await getListingBySlug(db, s.slug);
  if (existing) {
    skipped += 1;
    if (existing.status !== 'approved') {
      await setListingStatus(db, existing.id, 'approved');
    }
    continue;
  }
  const listing = await createListing(db, {
    slug: s.slug,
    name: s.name,
    description: s.description,
    category: s.category,
    ownerPrivyId: DEMO_OWNER_PRIVY_ID,
    ownerWallet: DEMO_OWNER_WALLET,
    endpoint: s.endpoint,
    pricing: s.pricing,
    tools: s.tools,
    ...(s.docsUrl ? { docsUrl: s.docsUrl } : {}),
    ...(s.freeTier !== undefined ? { freeTier: s.freeTier } : {}),
  });
  await setListingStatus(db, listing.id, 'approved');
  created += 1;
}

// eslint-disable-next-line no-console
console.log(`[seed-listings] created=${created} skipped=${skipped}`);

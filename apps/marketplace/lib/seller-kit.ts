/**
 * Seller-kit code-snippet generator.
 *
 * Given a listing draft (or its key fields), emit ready-to-paste code
 * for popular runtimes. The middleware short-circuits the request with
 * an HTTP 402 if no `x-payment` header is present, otherwise lets the
 * upstream handler run as normal.
 *
 * The runtime list is intentionally short and production-facing: a Hono
 * seller, receipt forwarding, a manifest, and a buyer-side probe.
 */

export type SnippetParams = {
  slug: string;
  toolName?: string;
  amount?: string;
  currency?: StableCurrency | string;
  network?: 'solana-devnet' | 'solana-mainnet';
  sellerAgent?: string;
  upstreamUrl?: string;
  rail?: PaymentRail;
  feePayerAddress?: string;
};

export type StableCurrency = 'USDC' | 'USDT' | 'USDG';
export type PaymentRail = 'x402' | 'mpp';

export const STABLE_CURRENCIES: StableCurrency[] = ['USDC', 'USDT', 'USDG'];
export const PAYMENT_RAILS: Array<{ id: PaymentRail; label: string; description: string }> = [
  { id: 'x402', label: 'x402', description: 'HTTP 402 payment-required header' },
  { id: 'mpp', label: 'MPP', description: 'problem+json challenge and PaymentScheme retry' },
];

const DEFAULTS: Required<SnippetParams> = {
  slug: 'premium-search',
  toolName: 'search',
  amount: '0.001',
  currency: 'USDC',
  network: 'solana-devnet',
  sellerAgent: '<your-leash-agent-address>',
  upstreamUrl: 'https://api.example-search.com/v1/search',
  rail: 'x402',
  feePayerAddress: '<facilitator-fee-payer-address>',
};

function merge(p: SnippetParams): Required<SnippetParams> {
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(p).filter(([, v]) => Boolean(v))) };
}

export type SnippetLanguage = 'hono' | 'receipts' | 'manifest' | 'curl';

export const LANGUAGES: Array<{ id: SnippetLanguage; label: string; sub: string }> = [
  { id: 'hono', label: 'Hono seller', sub: 'TS · @leashmarket/seller-kit' },
  { id: 'receipts', label: 'Receipts', sub: 'Explorer forwarding' },
  { id: 'manifest', label: 'leash-mcp.json', sub: 'Manifest file' },
  { id: 'curl', label: 'curl', sub: 'Buyer-side test' },
];

export function snippet(language: SnippetLanguage, params: SnippetParams): string {
  const p = merge(params);
  switch (language) {
    case 'hono':
      return honoSnippet(p);
    case 'receipts':
      return receiptsSnippet(p);
    case 'manifest':
      return manifestSnippet(p);
    case 'curl':
      return curlSnippet(p);
  }
}

function honoSnippet(p: Required<SnippetParams>): string {
  return p.rail === 'mpp' ? mppHonoSnippet(p) : x402HonoSnippet(p);
}

function x402HonoSnippet(p: Required<SnippetParams>): string {
  return `// Hono — gate a route with @leashmarket/seller-kit using x402
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { createSeller } from '@leashmarket/seller-kit';

const app = new Hono();
const umi = createUmi(process.env.SOLANA_RPC)
  .use(mplCore())
  .use(mplToolbox());

process.env.LEASH_API_URL = 'https://api.leash.market';
process.env.LEASH_API_KEY = '<your-leash-api-key>';

createSeller(app, {
  umi,
  // This is your Leash agent address, not an arbitrary receiving wallet.
  // seller-kit derives the on-chain payTo PDA from this identity.
  sellerAgent: { asset: '${p.sellerAgent}' },
  network: '${p.network}',
  facilitator: '${facilitatorFor(p.network)}',
  routes: {
    'POST /${p.slug}/${p.toolName}': {
      description: '${capitalize(p.slug.replace(/-/g, ' '))} ${p.toolName} endpoint',
      price: '${p.amount} ${p.currency}',
      currency: '${p.currency}',
      acceptsCurrencies: ['USDT', 'USDG'],
    },
  },
  // With LEASH_API_URL + LEASH_API_KEY set, seller-kit forwards earn receipts
  // so explorer.leash.market can show successful paid calls.
});

app.post('/${p.slug}/${p.toolName}', async (c) => {
  const { query } = await c.req.json();

  // Payment is verified before this runs. Put the API you want to monetize here.
  const upstream = await fetch('${p.upstreamUrl}', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, limit: 5 }),
  });

  if (!upstream.ok) {
    return c.json({ error: 'search_failed' }, 502);
  }

  const data = await upstream.json();
  return c.json({
    ok: true,
    query,
    results: data.results,
  });
});

serve({ fetch: app.fetch, port: 8080 });`;
}

function mppHonoSnippet(p: Required<SnippetParams>): string {
  return `// Hono — gate a route with @leashmarket/seller-kit using MPP
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { createMppSeller } from '@leashmarket/seller-kit';

const app = new Hono();
const umi = createUmi(process.env.SOLANA_RPC)
  .use(mplCore())
  .use(mplToolbox());

process.env.LEASH_API_URL = 'https://api.leash.market';
process.env.LEASH_API_KEY = '<your-leash-api-key>';

createMppSeller(app, {
  umi,
  // This is your Leash agent address, not an arbitrary receiving wallet.
  // seller-kit derives the on-chain payTo PDA from this identity.
  sellerAgent: { asset: '${p.sellerAgent}' },
  network: '${p.network}',
  facilitator: '${facilitatorFor(p.network)}',
  // MPP challenges include the facilitator fee payer that co-signs settlement.
  feePayerAddress: process.env.LEASH_MPP_FEE_PAYER ?? '${p.feePayerAddress}',
  routes: {
    'POST /${p.slug}/${p.toolName}': {
      description: '${capitalize(p.slug.replace(/-/g, ' '))} ${p.toolName} endpoint',
      price: '${p.amount} ${p.currency}',
      currency: '${p.currency}',
    },
  },
  // Use a shared challengeStore (Redis/KV) when running multiple instances.
});

app.post('/${p.slug}/${p.toolName}', async (c) => {
  const { query } = await c.req.json();

  // Payment is verified before this runs. Put the API you want to monetize here.
  const upstream = await fetch('${p.upstreamUrl}', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, limit: 5 }),
  });

  if (!upstream.ok) {
    return c.json({ error: 'search_failed' }, 502);
  }

  const data = await upstream.json();
  return c.json({
    ok: true,
    query,
    results: data.results,
  });
});

serve({ fetch: app.fetch, port: 8080 });`;
}

function receiptsSnippet(p: Required<SnippetParams>): string {
  return `// Explorer visibility needs receipt ingestion, not just an on-chain transfer.
const routes = {
  'POST /${p.slug}/${p.toolName}': {
    description: '${capitalize(p.slug.replace(/-/g, ' '))} ${p.toolName} endpoint',
    price: '${p.amount} ${p.currency}',
    currency: '${p.currency}',
  },
};

// Option A: let seller-kit use its built-in env-based receipt sink.
process.env.LEASH_API_URL = 'https://api.leash.market';
process.env.LEASH_API_KEY = '<your-leash-api-key>';

createSeller(app, {
  umi,
  sellerAgent: { asset: '${p.sellerAgent}' },
  network: '${p.network}',
  routes,
});

// Option B: forward explicitly.
createSeller(app, {
  umi,
  sellerAgent: { asset: '${p.sellerAgent}' },
  network: '${p.network}',
  routes,
  onReceipt: async (receipt) => {
    await fetch(\`https://api.leash.market/v1/receipts/\${receipt.agent}\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: \`Bearer \${process.env.LEASH_API_KEY}\`,
      },
      body: JSON.stringify(receipt),
    });
  },
});`;
}

function manifestSnippet(p: Required<SnippetParams>): string {
  return JSON.stringify(
    {
      name: capitalize(p.slug.replace(/-/g, ' ')),
      slug: p.slug,
      description: 'One-line description of what your capability does for agents.',
      category: 'misc',
      endpoint: `https://your-domain.com/mcp`,
      seller_agent: p.sellerAgent,
      protocol: p.rail,
      pricing: {
        type: p.amount === '0' ? 'free' : 'per_call',
        amount: p.amount,
        currency: p.currency,
      },
      tools: [
        {
          name: p.toolName,
          description: 'What this callable tool does, in one sentence.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      docs_url: 'https://your-domain.com/docs',
      free_tier: 100,
    },
    null,
    2,
  );
}

function curlSnippet(p: Required<SnippetParams>): string {
  return `# Test the public endpoint. The first call returns 402 with payment instructions.
curl -X POST https://your-domain.com/${p.slug}/${p.toolName} \\
  -H 'content-type: application/json' \\
  -d '{"query":"hello"}'

# Then pay from an agent treasury with @leashmarket/buyer-kit.
# The buyer agent needs balance + delegation before this can settle.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function facilitatorFor(network: Required<SnippetParams>['network']): string {
  return network === 'solana-mainnet'
    ? 'https://facilitator.leash.market'
    : 'https://facilitator-devnet.leash.market';
}

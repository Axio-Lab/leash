/**
 * Seller-kit code-snippet generator.
 *
 * Given a listing draft (or its key fields), emit ready-to-paste code
 * for popular runtimes. The middleware short-circuits the request with
 * an HTTP 402 if no `x-payment` header is present, otherwise lets the
 * upstream handler run as normal.
 *
 * The runtime list is intentionally short (Hono, Express, FastAPI, raw)
 * — the goal is "drop-in within minutes", not "every framework on
 * earth". The MCP example uses `@modelcontextprotocol/sdk` patterns.
 */

export type SnippetParams = {
  slug: string;
  toolName?: string;
  amount?: string;
  currency?: string;
  network?: 'solana-devnet' | 'solana-mainnet';
  sellerAgent?: string;
};

const DEFAULTS: Required<SnippetParams> = {
  slug: 'my-tool',
  toolName: 'search',
  amount: '0.001',
  currency: 'USDC',
  network: 'solana-devnet',
  sellerAgent: '<your-seller-agent-asset>',
};

function merge(p: SnippetParams): Required<SnippetParams> {
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(p).filter(([, v]) => Boolean(v))) };
}

export type SnippetLanguage = 'hono' | 'node' | 'receipts' | 'manifest' | 'curl';

export const LANGUAGES: Array<{ id: SnippetLanguage; label: string; sub: string }> = [
  { id: 'hono', label: 'Hono seller', sub: 'TS · @leashmarket/seller-kit' },
  { id: 'node', label: 'Node smoke', sub: 'TS · local paid endpoint test' },
  { id: 'receipts', label: 'Receipts', sub: 'Explorer forwarding' },
  { id: 'manifest', label: 'leash-mcp.json', sub: 'Manifest file' },
  { id: 'curl', label: 'curl', sub: 'Buyer-side test' },
];

export function snippet(language: SnippetLanguage, params: SnippetParams): string {
  const p = merge(params);
  switch (language) {
    case 'hono':
      return honoSnippet(p);
    case 'node':
      return nodeSmokeSnippet(p);
    case 'receipts':
      return receiptsSnippet(p);
    case 'manifest':
      return manifestSnippet(p);
    case 'curl':
      return curlSnippet(p);
  }
}

function honoSnippet(p: Required<SnippetParams>): string {
  return `// Hono — gate a route with @leashmarket/seller-kit
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { createSeller } from '@leashmarket/seller-kit';

const app = new Hono();
const umi = createUmi(process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com')
  .use(mplCore())
  .use(mplToolbox());

createSeller(app, {
  umi,
  // This is a Leash/Metaplex Core agent asset, not a wallet address.
  // seller-kit derives the on-chain payTo PDA from this identity.
  sellerAgent: { asset: process.env.LEASH_SELLER_AGENT ?? '${p.sellerAgent}' },
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
  // Optional: set LEASH_API_URL + LEASH_API_KEY or LEASH_RUNNER_URL
  // and seller-kit will forward earn receipts to explorer-compatible storage.
});

app.post('/${p.slug}/${p.toolName}', async (c) => {
  const body = await c.req.json();
  // payment is verified before this runs
  return c.json({ ok: true, query: body.query });
});

serve({ fetch: app.fetch, port: 8080 });`;
}

function nodeSmokeSnippet(p: Required<SnippetParams>): string {
  return `# Run the same kind of smoke test we use locally.
# It starts a seller-kit Hono endpoint, probes for 402, then pays with buyer-kit.
LEASH_E2E_SELLER_AGENT=${p.sellerAgent} \\
LEASH_SMOKE_PRICE='${p.amount} ${p.currency}' \\
pnpm --filter @leashmarket/api exec tsx \\
  --env-file-if-exists=.env.e2e \\
  scripts/seller-kit-local-smoke.ts`;
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
process.env.LEASH_API_URL = 'http://localhost:8801';
process.env.LEASH_API_KEY = 'lsh_test_...';

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
    await fetch(\`http://localhost:8801/v1/receipts/\${receipt.agent}\`, {
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

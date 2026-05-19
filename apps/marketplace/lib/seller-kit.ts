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
  payTo?: string;
};

const DEFAULTS: Required<SnippetParams> = {
  slug: 'my-tool',
  toolName: 'search',
  amount: '0.001',
  currency: 'USDC',
  network: 'solana-devnet',
  payTo: '<your-wallet-address>',
};

function merge(p: SnippetParams): Required<SnippetParams> {
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(p).filter(([, v]) => Boolean(v))) };
}

export type SnippetLanguage = 'hono' | 'express' | 'fastapi' | 'mcp' | 'manifest' | 'curl';

export const LANGUAGES: Array<{ id: SnippetLanguage; label: string; sub: string }> = [
  { id: 'hono', label: 'Hono', sub: 'TS · Cloudflare / Bun / Node' },
  { id: 'express', label: 'Express', sub: 'TS · Node' },
  { id: 'fastapi', label: 'FastAPI', sub: 'Python · Uvicorn' },
  { id: 'mcp', label: 'MCP server', sub: 'TS · @modelcontextprotocol/sdk' },
  { id: 'manifest', label: 'leash-mcp.json', sub: 'Manifest file' },
  { id: 'curl', label: 'curl', sub: 'Buyer-side test' },
];

export function snippet(language: SnippetLanguage, params: SnippetParams): string {
  const p = merge(params);
  switch (language) {
    case 'hono':
      return honoSnippet(p);
    case 'express':
      return expressSnippet(p);
    case 'fastapi':
      return fastapiSnippet(p);
    case 'mcp':
      return mcpSnippet(p);
    case 'manifest':
      return manifestSnippet(p);
    case 'curl':
      return curlSnippet(p);
  }
}

function honoSnippet(p: Required<SnippetParams>): string {
  return `// Hono — drop in front of any tool route
import { Hono } from 'hono';
import { x402Middleware } from '@leashmarket/seller-kit/hono';

const app = new Hono();

app.use(
  '/${p.slug}/*',
  x402Middleware({
    price: { amount: '${p.amount}', currency: '${p.currency}' },
    network: '${p.network}',
    payTo: '${p.payTo}',
    facilitator: 'https://facilitator-devnet.leash.market',
  }),
);

app.post('/${p.slug}/${p.toolName}', async (c) => {
  const body = await c.req.json();
  // payment is verified before this runs
  return c.json({ ok: true, query: body.query });
});

export default app;`;
}

function expressSnippet(p: Required<SnippetParams>): string {
  return `// Express — drop in front of any tool route
import express from 'express';
import { x402Express } from '@leashmarket/seller-kit/express';

const app = express();

app.use(express.json());
app.use(
  '/${p.slug}',
  x402Express({
    price: { amount: '${p.amount}', currency: '${p.currency}' },
    network: '${p.network}',
    payTo: '${p.payTo}',
    facilitator: 'https://facilitator-devnet.leash.market',
  }),
);

app.post('/${p.slug}/${p.toolName}', (req, res) => {
  // payment is verified before this runs
  res.json({ ok: true, query: req.body.query });
});

app.listen(8080);`;
}

function fastapiSnippet(p: Required<SnippetParams>): string {
  return `# FastAPI — drop in front of any tool route
from fastapi import FastAPI, Request
from leash_seller_kit.fastapi import x402_required

app = FastAPI()

@app.post("/${p.slug}/${p.toolName}")
@x402_required(
    amount="${p.amount}",
    currency="${p.currency}",
    network="${p.network}",
    pay_to="${p.payTo}",
    facilitator="https://facilitator-devnet.leash.market",
)
async def ${p.toolName}(request: Request):
    body = await request.json()
    # payment is verified before this runs
    return {"ok": True, "query": body.get("query")}`;
}

function mcpSnippet(p: Required<SnippetParams>): string {
  return `// MCP server — every tool call gated by x402
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withX402 } from '@leashmarket/seller-kit/mcp';

const server = new McpServer({ name: '${p.slug}', version: '0.1.0' });

server.tool(
  '${p.toolName}',
  'Description shown to the agent',
  { query: z.string() },
  withX402(
    {
      price: { amount: '${p.amount}', currency: '${p.currency}' },
      network: '${p.network}',
      payTo: '${p.payTo}',
    },
    async ({ query }) => {
      // payment is verified before this runs
      const results = await mySearchAPI(query);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  ),
);

server.start();`;
}

function manifestSnippet(p: Required<SnippetParams>): string {
  return JSON.stringify(
    {
      name: capitalize(p.slug.replace(/-/g, ' ')),
      slug: p.slug,
      description: 'One-line description of what your capability does for agents.',
      category: 'misc',
      endpoint: `https://your-domain.com/mcp`,
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
  return `# Test it from the buyer side. The first call returns 402 with payment instructions.
curl -X POST https://your-domain.com/${p.slug}/${p.toolName} \\
  -H 'content-type: application/json' \\
  -d '{"query":"hello"}'

# Then sign + retry with the leash buyer-kit:
npx @leashmarket/buyer-kit pay \\
  --url https://your-domain.com/${p.slug}/${p.toolName} \\
  --key lsh_live_… \\
  --body '{"query":"hello"}'`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

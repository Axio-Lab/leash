import { NextResponse } from 'next/server';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';
import type { ReceiptV1 } from '@leash/schemas';
import { FACILITATOR_URL, RUNNER_URL, SOLANA_RPC } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Playground echo seller. Uses the real `@leash/seller-kit` so:
 *   1. 402 is enforced via `simpleX402Gate` (matches production wiring)
 *   2. Every paid call emits an `earn` `ReceiptV1` to `${RUNNER_URL}/a/:agent/receipts`
 *      so the explorer fills from BOTH sides of the trade.
 *
 * The seller agent address can be overridden per request via `?asset=<mint>`,
 * which is what the playground UI does so the receipt lands on the agent the
 * user is currently inspecting.
 */

const PLACEHOLDER_ASSET = '11111111111111111111111111111111';

async function postReceipt(r: ReceiptV1): Promise<void> {
  await fetch(`${RUNNER_URL}/a/${r.agent}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(r),
  }).catch(() => {
    /* runner offline — receipts skipped, request still succeeds */
  });
}

function buildApp(asset: string): Hono {
  const umi = createUmi(SOLANA_RPC).use(mplCore());
  const app = new Hono();
  createSeller(app, {
    umi,
    sellerAgent: { asset },
    facilitator: FACILITATOR_URL,
    routes: { 'POST /api/seller/echo': { price: '$0.001', description: 'Echo' } },
    onReceipt: postReceipt,
  });
  app.post('/api/seller/echo', async (c) => {
    const text = await c.req.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON; that's fine */
    }
    return c.json({ ok: true, echoed: parsed, receivedAt: new Date().toISOString() });
  });
  return app;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get('asset') || PLACEHOLDER_ASSET;
  const app = buildApp(asset);
  return app.fetch(req);
}

export async function GET() {
  return NextResponse.json({
    info: 'POST here with `x-payment` header (and `?asset=<mint>` to attribute receipts) to receive an echo. 402 otherwise.',
  });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RulesV1Schema, type ReceiptV1 } from '@leash/schemas';
import { createBuyer } from '@leash/buyer-kit';
import { RUNNER_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function shipReceipt(receipt: ReceiptV1): Promise<void> {
  // Ship to the runner so the explorer feed picks it up. Fire-and-forget;
  // failures are intentionally swallowed inside `createBuyer`.
  await fetch(`${RUNNER_URL}/a/${receipt.agent}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(receipt),
  });
}

const Body = z.object({
  agent: z.string().min(1),
  rules: RulesV1Schema,
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  body: z.string().optional(),
});

/**
 * Server-side wrapper around `createBuyer({...}).fetch(...)`. We never let the
 * browser construct a buyer because `@leash/buyer-kit` pulls in `@leash/core`
 * which uses Node crypto for receipt hashing.
 */
export async function POST(req: Request) {
  let payload: z.infer<typeof Body>;
  try {
    const json = await req.json();
    payload = Body.parse(json);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? 'invalid body' }, { status: 400 });
  }

  try {
    const buyer = createBuyer({
      agent: payload.agent,
      rules: payload.rules,
      onReceipt: shipReceipt,
    });
    const init: RequestInit = { method: payload.method };
    if (payload.body && payload.method !== 'GET') {
      init.body = payload.body;
      init.headers = { 'content-type': 'application/json' };
    }
    const { response, receipt } = await buyer.fetch(payload.url, init);
    let responseBody: unknown = null;
    const text = await response.text();
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
    return NextResponse.json({
      receipt,
      response: { status: response.status, body: responseBody },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'buyer.fetch failed' },
      { status: 500 },
    );
  }
}

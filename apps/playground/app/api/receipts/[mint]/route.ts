import { NextResponse } from 'next/server';
import { parseReceiptAny, type ReceiptAny } from '@leashmarket/schemas';
import { getReceiptsJsonl } from '@/lib/runner';
import { RUNNER_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Returns a parsed JSON array of receipts for `mint` (drops malformed lines so
 * the UI never crashes on a partial write).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ mint: string }> },
): Promise<Response> {
  const { mint } = await params;
  const text = await getReceiptsJsonl(mint);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const receipts: ReceiptAny[] = [];
  const errors: Array<{ line: number; error: string }> = [];

  lines.forEach((raw, idx) => {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      errors.push({ line: idx + 1, error: (err as Error).message });
      return;
    }
    try {
      receipts.push(parseReceiptAny(json));
    } catch (err) {
      errors.push({ line: idx + 1, error: (err as Error).message });
    }
  });

  return NextResponse.json({ mint, receipts, errors });
}

/**
 * Browser-safe proxy for shipping a receipt to the runner. The runner has no
 * CORS preflight, so the buyer playground (which now signs with Privy in the
 * browser) POSTs receipts here and we forward to `${RUNNER}/a/:mint/receipts`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ mint: string }> },
): Promise<Response> {
  const { mint } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? 'invalid_json' }, { status: 400 });
  }
  let receipt: ReceiptAny;
  try {
    receipt = parseReceiptAny(body);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_receipt', detail: (err as Error).message },
      { status: 422 },
    );
  }
  if (receipt.agent !== mint) {
    return NextResponse.json(
      { error: 'agent_mismatch', detail: `receipt.agent=${receipt.agent} != :mint=${mint}` },
      { status: 422 },
    );
  }
  try {
    const upstream = await fetch(`${RUNNER_URL}/a/${mint}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(receipt),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'runner_offline' },
      { status: 502 },
    );
  }
}

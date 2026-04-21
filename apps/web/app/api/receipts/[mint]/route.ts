import { NextResponse } from 'next/server';
import { ReceiptV1Schema, type ReceiptV1 } from '@leash/schemas';
import { getReceiptsJsonl } from '@/lib/runner';

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

  const receipts: ReceiptV1[] = [];
  const errors: Array<{ line: number; error: string }> = [];

  lines.forEach((raw, idx) => {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      errors.push({ line: idx + 1, error: (err as Error).message });
      return;
    }
    const parsed = ReceiptV1Schema.safeParse(json);
    if (parsed.success) {
      receipts.push(parsed.data);
    } else {
      errors.push({ line: idx + 1, error: parsed.error.message });
    }
  });

  return NextResponse.json({ mint, receipts, errors });
}

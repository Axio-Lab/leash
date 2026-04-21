import { NextResponse } from 'next/server';
import { getReceiptsJsonl } from '@/lib/runner';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ mint: string }> },
): Promise<Response> {
  const { mint } = await params;
  const text = await getReceiptsJsonl(mint);
  return new NextResponse(text, {
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

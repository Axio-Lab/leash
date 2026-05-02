import { NextResponse } from 'next/server';
import { getPause } from '@/lib/runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getPause();
  return NextResponse.json(data);
}

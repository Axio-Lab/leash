import { NextResponse } from 'next/server';
import { getHealth } from '@/lib/runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getHealth();
  return NextResponse.json(data);
}

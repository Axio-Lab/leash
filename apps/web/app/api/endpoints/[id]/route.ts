import { NextResponse } from 'next/server';
import { RUNNER_URL } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(new URL(`/endpoints/${encodeURIComponent(id)}`, RUNNER_URL), {
      cache: 'no-store',
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'runner_unreachable', detail: (err as Error).message, runner: RUNNER_URL },
      { status: 502 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(new URL(`/endpoints/${encodeURIComponent(id)}`, RUNNER_URL), {
      method: 'DELETE',
    });
    const text = await res.text();
    if (res.status === 204) return new Response(null, { status: 204 });
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'runner_unreachable', detail: (err as Error).message, runner: RUNNER_URL },
      { status: 502 },
    );
  }
}

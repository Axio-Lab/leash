import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

const BodySchema = z.object({
  key: z.string().min(20),
});

const buckets = new Map<string, number[]>();

function allow(privyId: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const max = 5;
  const prev = buckets.get(privyId) ?? [];
  const next = prev.filter((t) => now - t < windowMs);
  if (next.length >= max) return false;
  next.push(now);
  buckets.set(privyId, next);
  return true;
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  if (!allow(session.privyId)) {
    return NextResponse.json({ ok: false as const, reason: 'rate_limited' }, { status: 429 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parsed.data.key.startsWith('sk-ant-')) {
    return NextResponse.json({ ok: false as const, reason: 'invalid_key' }, { status: 400 });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': parsed.data.key,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json({
        ok: false as const,
        reason: `upstream_${res.status}`,
        detail: errText.slice(0, 400),
      });
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    return NextResponse.json({ ok: true as const, models });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'request_failed';
    return NextResponse.json({ ok: false as const, reason: message });
  }
}

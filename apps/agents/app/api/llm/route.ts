import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { encryptSecret } from '@leash/platform-auth/encryption';

import { getDb } from '@/lib/db';
import { ensureAgentChatTables } from '@/lib/db-schema';
import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const db = getDb();
  await ensureAgentChatTables(db);
  const row = await db.execute({
    sql: `SELECT last4, updated_at FROM user_llm_keys WHERE privy_id = ? LIMIT 1`,
    args: [session.privyId],
  });
  const r = row.rows[0] as { last4?: string; updated_at?: string } | undefined;
  if (!r?.last4) {
    return NextResponse.json({ saved: false as const });
  }
  return NextResponse.json({
    saved: true as const,
    provider: 'anthropic' as const,
    last4: r.last4,
    savedAt: r.updated_at ?? null,
  });
}

const PutSchema = z.object({
  key: z.string().min(20),
});

export async function PUT(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parsed.data.key.startsWith('sk-ant-')) {
    return NextResponse.json({ error: 'invalid_key' }, { status: 400 });
  }

  const env = getServerEnv();
  const envelope = encryptSecret(parsed.data.key, env.encryptionKey);
  const last4 = parsed.data.key.slice(-4);

  const db = getDb();
  await ensureAgentChatTables(db);

  await db.execute({
    sql: `
      INSERT INTO user_llm_keys (privy_id, provider, envelope, last4, created_at, updated_at)
      VALUES (?, 'anthropic', ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(privy_id) DO UPDATE SET
        envelope = excluded.envelope,
        last4 = excluded.last4,
        updated_at = datetime('now')
    `,
    args: [session.privyId, envelope, last4],
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const db = getDb();
  await ensureAgentChatTables(db);
  await db.execute({
    sql: `DELETE FROM user_llm_keys WHERE privy_id = ?`,
    args: [session.privyId],
  });
  return NextResponse.json({ ok: true });
}

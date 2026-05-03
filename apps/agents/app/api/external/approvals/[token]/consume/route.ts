import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * Mirror of `ConsumeApprovalBody` on apps/api — flat shape so we can
 * forward the JSON unchanged. Either `tx_sig` / `receipt_hash` (success)
 * or `error` (cancellation) is set; the API enforces "at least one".
 */
const ConsumeBodySchema = z
  .object({
    receipt_hash: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
    tx_sig: z.string().min(43).max(120).optional(),
    error: z.string().min(1).max(2000).optional(),
  })
  .refine((b) => b.receipt_hash || b.tx_sig || b.error, {
    message: 'must include at least one of receipt_hash, tx_sig, error',
  });

/**
 * `POST /api/external/approvals/{token}/consume` — proxies the admin
 * consume endpoint on apps/api. The browser calls this once the user
 * has signed the underlying transaction with their Privy wallet (or
 * the user clicked "cancel" — sent through as `{error}`).
 *
 * The token itself is the primary access control: it's an unguessable
 * 24-byte secret embedded in the one-time deep link the dispatcher
 * sent through the bound chat. The BFF additionally requires a Privy
 * session so anonymous bots can't sweep tokens by guessing — but we
 * don't (and can't, the public read endpoint scrubs owner_privy_id)
 * verify the consumer matches the connection owner. In practice the
 * Privy signing step would fail anyway for a stranger, since they
 * couldn't sign on behalf of the target wallet.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { token } = await params;
  const raw = (await req.json().catch(() => null)) as unknown;
  const parsed = ConsumeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const env = getServerEnv();
  const res = await fetch(
    `${env.leashApiUrl}/v1/external/approvals/${encodeURIComponent(token)}/consume`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.leashApiAdminSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(parsed.data),
    },
  );
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAgent } from '@leash/registry-utils';
import { getServerUmi } from '@/lib/umi';

export const runtime = 'nodejs';

/**
 * POST /api/agents/create
 *
 *  Server-side fallback for headless / scripted callers (CI, cron, mock data
 *  seeding). Requires `LEASH_DEV_PAYER_SECRET_KEY`.
 *
 *  The web playground signs `createAgent` directly in the browser using the
 *  user's connected Privy wallet (see `apps/web/app/agents/new/page.tsx` and
 *  `apps/web/lib/privy-umi.ts`) — that path does NOT hit this endpoint.
 */
const Body = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(2_000),
  uri: z.string().url(),
  network: z
    .enum([
      'solana-mainnet',
      'solana-devnet',
      'localnet',
      'eclipse-mainnet',
      'sonic-mainnet',
      'sonic-devnet',
      'fogo-mainnet',
      'fogo-testnet',
    ])
    .default('solana-devnet'),
  services: z.array(z.object({ name: z.string().min(1), endpoint: z.string().min(1) })).default([]),
  supportedTrust: z.array(z.string()).default([]),
});

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof Body>;
  try {
    const json = (await req.json()) as unknown;
    parsed = Body.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  let umi;
  try {
    umi = getServerUmi();
  } catch (err) {
    return NextResponse.json(
      { error: 'server_signer_unavailable', detail: (err as Error).message },
      { status: 503 },
    );
  }

  try {
    const result = await createAgent(umi, {
      wallet: String(umi.identity.publicKey),
      network: parsed.network,
      name: parsed.name,
      description: parsed.description,
      uri: parsed.uri,
      services: parsed.services,
      supportedTrust: parsed.supportedTrust,
    });
    return NextResponse.json({ ok: true, ...result, owner: String(umi.identity.publicKey) });
  } catch (err) {
    return NextResponse.json(
      { error: 'mint_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

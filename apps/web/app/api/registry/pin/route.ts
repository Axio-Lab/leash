import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pinJson } from '@leash/registry-utils';

export const runtime = 'nodejs';

/**
 * POST /api/registry/pin
 *
 * Pins arbitrary JSON to Pinata IPFS using `PINATA_JWT` from the server env.
 * The JWT NEVER leaves the server. The client gets back the public gateway
 * URL it can pass to `createAgent({ uri })`.
 *
 * Body:
 *   { json: <any JSON object>, name?: string }
 */
const Body = z.object({
  json: z.record(z.unknown()).or(z.array(z.unknown())),
  name: z.string().min(1).max(128).optional(),
});

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  if (!process.env.PINATA_JWT) {
    return NextResponse.json(
      {
        error: 'pinata_jwt_missing',
        detail:
          'Set PINATA_JWT in apps/web/.env.local (https://app.pinata.cloud → API Keys). The web app needs it to upload metadata for you.',
      },
      { status: 503 },
    );
  }

  try {
    const result = await pinJson(parsed.json, { name: parsed.name });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'pin_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

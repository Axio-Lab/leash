import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RegistrationV1Schema } from '@leashmarket/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Q = z.object({ uri: z.string().url() });

/**
 * GET /api/registry/resolve?uri=...
 *
 * Fetches `uri` and returns the body as `document`. The MIP-104 schema check
 * is best-effort — most agent registration URIs in the wild (notably the
 * Metaplex Agents API) return a `type: "agent"` document that is *similar*
 * to but not exactly `RegistrationV1` (which requires
 * `type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"`).
 *
 * We always return the raw JSON so the playground can render it; `valid`
 * tells the UI whether it's strict MIP-104.
 *
 * Status codes:
 *   400 — bad query
 *   200 — fetched JSON (regardless of schema validity; see `valid`)
 *   502 — upstream returned non-2xx or non-JSON
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_query', detail: parsed.error.message },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.data.uri);
  } catch (err) {
    return NextResponse.json(
      { error: 'fetch_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: 'upstream_error',
        detail: `Registration URI returned ${upstream.status}`,
        status: upstream.status,
      },
      { status: 502 },
    );
  }

  let document: unknown;
  try {
    document = await upstream.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: 'not_json',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const schema = RegistrationV1Schema.safeParse(document);
  return NextResponse.json({
    uri: parsed.data.uri,
    document,
    source: 'byo',
    valid: schema.success,
    schemaError: schema.success ? null : schema.error.message,
  });
}

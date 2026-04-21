import { NextResponse } from 'next/server';
import { pinFile } from '@leash/registry-utils';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_PREFIX = 'image/';

/**
 * POST /api/registry/pin-file
 *
 * Accepts a `multipart/form-data` upload with a single `file` field and pins
 * it to Pinata IPFS via `PINATA_JWT` (server-side only). Used by the agent
 * creation playground for the optional avatar/image. The browser receives
 * `{ ok, gatewayUrl, cid, uri }` and embeds `gatewayUrl` as `image` in the
 * metadata that gets pinned by `/api/registry/pin`.
 *
 * Limits:
 *   - 8 MB max (Pinata's free tier easily handles this; large videos belong
 *     in a dedicated CDN, not the on-chain metadata blob).
 *   - `image/*` MIME types only — this endpoint is for agent imagery, not
 *     arbitrary file storage.
 */
export async function POST(req: Request): Promise<Response> {
  if (!process.env.PINATA_JWT) {
    return NextResponse.json(
      {
        error: 'pinata_jwt_missing',
        detail:
          'Set PINATA_JWT in apps/web/.env.local (https://app.pinata.cloud → API Keys). The web app needs it to upload images for you.',
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'missing_file', detail: 'Expected a `file` field in multipart body.' },
      { status: 400 },
    );
  }

  if (!file.type.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json(
      { error: 'unsupported_type', detail: `Only image/* uploads allowed (got "${file.type}").` },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: 'file_too_large',
        detail: `Max ${MAX_BYTES / 1024 / 1024} MB (got ${(file.size / 1024 / 1024).toFixed(2)} MB).`,
      },
      { status: 413 },
    );
  }

  try {
    const result = await pinFile({
      data: file,
      filename: file.name || 'agent-image',
      contentType: file.type,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'pin_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

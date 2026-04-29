/**
 * Image-upload + serve routes.
 *
 *   POST /v1/platform/uploads/image  (admin) — stash a PNG/JPEG/WEBP
 *      data URL into `image_blobs`; returns a content-addressable
 *      `{ hash, url, size, mime }` envelope. Idempotent (sha256 PK).
 *
 *   GET  /v1/uploads/{hash}          (public) — serve the bytes with
 *      the persisted `Content-Type`. Suitable as an `<img src>`.
 *
 * Why content-addressable? The agent-creation flow uploads the image
 * BEFORE the asset is minted (we don't know the mint address yet),
 * builds the EIP-8004 RegistrationV1 doc with `image: <upload URL>`,
 * then mints. Hashing decouples the image from any one agent and lets
 * the same bytes back multiple agents without duplicate storage.
 */

import { Hono } from 'hono';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { adminAuth } from '../auth/admin.js';
import type { LeashApiConfig } from '../config.js';
import {
  IMAGE_LIMITS,
  ImageTooLargeError,
  UnsupportedMimeError,
  decodeDataUrl,
  getImageBlob,
  putImageBlob,
} from '../storage/image-blobs.js';
import type { DbClient } from '../storage/turso.js';
import { ApiErrorSchema } from '../openapi/common.js';
import { invalidRequest } from '../util/errors.js';

export type UploadDeps = { config: LeashApiConfig; db: DbClient };

const UploadImageBody = z
  .object({
    data_url: z
      .string()
      .min(20)
      .max(IMAGE_LIMITS.maxBytes * 2)
      .openapi({
        description: 'Base64 `data:image/...;base64,...` URL. ≤ 1.5 MiB decoded.',
      }),
  })
  .openapi('UploadImageBody');

const UploadImageEcho = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/i),
    url: z.string().openapi({
      description: 'Public URL to fetch the bytes from. Mountable as `<img src>`.',
    }),
    size: z.number().int().nonnegative(),
    mime: z.string(),
  })
  .openapi('UploadImageEcho');

export function buildUploadRoutes(deps: UploadDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  app.use('/v1/platform/uploads/*', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/uploads/image',
      tags: ['platform'],
      summary: 'Upload an image as a content-addressable blob',
      security: [{ AdminSecret: [] }],
      request: {
        body: { required: true, content: { 'application/json': { schema: UploadImageBody } } },
      },
      responses: {
        200: {
          description: 'Stored (or already present).',
          content: { 'application/json': { schema: UploadImageEcho } },
        },
        422: {
          description: 'invalid / too large / unsupported mime',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { data_url } = c.req.valid('json');
      const decoded = decodeDataUrl(data_url);
      if (!decoded) throw invalidRequest('data_url must be a base64 data URL.');
      try {
        const stored = await putImageBlob(deps.db, decoded);
        const origin = (deps.config.publicOrigin ?? '').replace(/\/+$/, '');
        const url = origin ? `${origin}/v1/uploads/${stored.hash}` : `/v1/uploads/${stored.hash}`;
        return c.json({ hash: stored.hash, url, size: stored.size, mime: stored.mime }, 200);
      } catch (err) {
        if (err instanceof ImageTooLargeError) {
          throw invalidRequest(`image too large: ${err.message}`, {
            limit_bytes: IMAGE_LIMITS.maxBytes,
            size: err.size,
          });
        }
        if (err instanceof UnsupportedMimeError) {
          throw invalidRequest(`unsupported mime "${err.mime}"`, {
            allowed: IMAGE_LIMITS.allowedMimes,
          });
        }
        throw err;
      }
    },
  );

  return app;
}

/**
 * Public byte-serving route. Mounted unauthenticated on the root app —
 * `<img src="…/v1/uploads/<hash>">` Just Works.
 */
export function buildPublicUploadRoutes(deps: UploadDeps): Hono {
  const app = new Hono();
  app.get('/v1/uploads/:hash', async (c) => {
    const blob = await getImageBlob(deps.db, c.req.param('hash'));
    if (!blob) return c.notFound();
    return new Response(blob.bytes, {
      status: 200,
      headers: {
        'content-type': blob.mime,
        'content-length': String(blob.size),
        // 30-day immutable cache — bytes are content-addressable, so
        // changing them changes the URL.
        'cache-control': 'public, max-age=2592000, immutable',
      },
    });
  });
  return app;
}

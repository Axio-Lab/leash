import { NextResponse } from 'next/server';
import { Uploader } from '@irys/upload';
import { Solana } from '@irys/upload-solana';
import bs58 from 'bs58';

export const runtime = 'nodejs';

/**
 * POST /api/irys/upload-image
 *
 * Accepts a `multipart/form-data` upload with a single `file` field and
 * uploads it to the Irys network via a server-side Solana keypair. Returns
 * `{ ok, gatewayUrl, id, network }` where `gatewayUrl` is the
 * `https://gateway.irys.xyz/<id>` URL the Metaplex Genesis API requires.
 *
 * Why a dedicated route (and not /api/registry/pin-file)?
 *
 *   The Metaplex Genesis API explicitly rejects every non-Irys host for
 *   the `image` field of an agent-token launch — see the docs note:
 *   "The image field must point to an Irys gateway URL. Other hosts will
 *   fail API validation." So Pinata / IPFS won't work for this surface
 *   even though we use them everywhere else for `RegistrationV1` blobs.
 *
 * Funding model:
 *
 *   - Files smaller than `FREE_BYTES` (100 KiB on Irys mainnet) upload
 *     for free; we still need a signing wallet but it doesn't have to
 *     hold any SOL.
 *   - Anything larger requires the configured wallet to hold ~0.001 SOL
 *     per MB. Surface a 502 with the funding hint when it doesn't.
 *
 *   `IRYS_NETWORK=devnet` switches to Irys's free devnet (uploads expire
 *   after ~30 days). Useful for the playground; do NOT use on the token
 *   you intend to keep.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_PREFIX = 'image/';
const FREE_BYTES = 100 * 1024;
const GATEWAY = 'https://gateway.irys.xyz';

type IrysNetwork = 'mainnet' | 'devnet';

function normaliseNetwork(value: string | undefined): IrysNetwork {
  return value === 'devnet' ? 'devnet' : 'mainnet';
}

function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as number[];
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error(
        `IRYS_FUNDING_SECRET_KEY: expected a 64-byte JSON array, got length ${parsed.length}`,
      );
    }
    return Uint8Array.from(parsed);
  }
  const bytes = bs58.decode(trimmed);
  if (bytes.length !== 64) {
    throw new Error(
      `IRYS_FUNDING_SECRET_KEY: base58 decode produced ${bytes.length} bytes, expected 64`,
    );
  }
  return bytes;
}

async function getUploader(network: IrysNetwork) {
  const secret = process.env.IRYS_FUNDING_SECRET_KEY;
  if (!secret) {
    throw Object.assign(new Error('irys_funding_key_missing'), {
      detail:
        'Set IRYS_FUNDING_SECRET_KEY in apps/web/.env.local. Any Solana keypair works; ' +
        'files <100 KiB upload free on Irys mainnet so the wallet does not need to hold SOL.',
      status: 503,
    });
  }
  const bytes = parseSecretKey(secret);
  // Irys SDK expects the base58 secret-key form for Solana wallets.
  const wallet = bs58.encode(bytes);
  // The builder is "thenable" — `withRpc` / `devnet` must be chained on
  // the builder *before* awaiting; once awaited it resolves to a
  // `BaseNodeIrys` that no longer exposes those configuration knobs.
  let builder = Uploader(Solana).withWallet(wallet);
  if (network === 'devnet') {
    builder = builder.withRpc('https://api.devnet.solana.com').devnet();
  }
  return await builder;
}

export async function POST(req: Request): Promise<Response> {
  const network = normaliseNetwork(process.env.IRYS_NETWORK);

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

  let uploader: Awaited<ReturnType<typeof getUploader>>;
  try {
    uploader = await getUploader(network);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      const e = err as { message: string; detail?: string; status: number };
      return NextResponse.json({ error: e.message, detail: e.detail }, { status: e.status });
    }
    return NextResponse.json(
      { error: 'irys_init_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const tags = [
      { name: 'Content-Type', value: file.type },
      { name: 'App-Name', value: 'leash-agent-token' },
      { name: 'Original-Filename', value: file.name || 'upload' },
    ];

    if (file.size > FREE_BYTES) {
      // Upload requires payment — surface a clean error if the wallet
      // can't cover it instead of letting Irys throw an opaque RPC error.
      const price = await uploader.getPrice(file.size);
      const balance = await uploader.getLoadedBalance();
      if (balance.lt(price)) {
        return NextResponse.json(
          {
            error: 'irys_balance_too_low',
            detail:
              `Irys upload for ${(file.size / 1024).toFixed(1)} KiB needs ${price.toString()} ` +
              `(${uploader.token}); funded wallet has ${balance.toString()}. Either fund the ` +
              `IRYS_FUNDING_SECRET_KEY wallet (~0.001 SOL is plenty) or shrink the image to under ` +
              `${FREE_BYTES / 1024} KiB to use the free tier.`,
          },
          { status: 402 },
        );
      }
    }

    const receipt = await uploader.upload(buffer, { tags });
    const gatewayUrl = `${GATEWAY}/${receipt.id}`;
    return NextResponse.json({
      ok: true,
      id: receipt.id,
      gatewayUrl,
      network,
      bytes: file.size,
      contentType: file.type,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'irys_upload_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

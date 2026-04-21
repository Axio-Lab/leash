/**
 * Upload a registration JSON document (Pinata when PINATA_JWT is set).
 *
 * Usage: pnpm exec tsx scripts/upload-registration.ts <path-to-json>
 */
import { readFile } from 'node:fs/promises';
import type { RegistrationV1 } from '@leash/schemas';
import { resolveOrUpload } from '@leash/registry-utils';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: upload-registration.ts <registration.json>');
    process.exit(2);
  }
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const out = await resolveOrUpload({ json: raw as RegistrationV1 });
  console.log('URI:', out.uri, 'source:', out.source);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

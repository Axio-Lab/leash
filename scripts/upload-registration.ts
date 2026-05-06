/**
 * Resolve a registration JSON document from a public URL.
 *
 * Usage: pnpm exec tsx scripts/upload-registration.ts <https://…/registration.json>
 */
import { resolveByoUri } from '@leashmarket/registry-utils';

async function main(): Promise<void> {
  const uri = process.argv[2];
  if (!uri) {
    console.error('Usage: upload-registration.ts <registration-json-url>');
    process.exit(2);
  }
  const out = await resolveByoUri(uri);
  console.log('URI:', out.uri);
  console.log('Resolved name:', out.document.name);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

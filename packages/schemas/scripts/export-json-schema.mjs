import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  EndpointV1Schema,
  LeashBlockV1Schema,
  ReceiptV1Schema,
  RegistrationV1Schema,
  RulesV1Schema,
} from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'dist', 'schemas');

await mkdir(outDir, { recursive: true });

const specs = [
  ['receipt-v1', ReceiptV1Schema],
  ['rules-v1', RulesV1Schema],
  ['leash-block-v1', LeashBlockV1Schema],
  ['registration-v1', RegistrationV1Schema],
  ['endpoint-v1', EndpointV1Schema],
];

for (const [name, schema] of specs) {
  const json = JSON.stringify(zodToJsonSchema(schema, { name, $refStrategy: 'none' }), null, 2);
  await writeFile(join(outDir, `${name}.json`), json + '\n');
}

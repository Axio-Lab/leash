#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateReceiptFeed } from '../conformance/receipt-feed.js';

async function main(): Promise<void> {
  const pathOrUrl = process.argv[2];
  if (!pathOrUrl) {
    console.error('Usage: leash-conformance <path-to.jsonl|->');
    process.exit(2);
  }
  const text =
    pathOrUrl === '-'
      ? await new Promise<string>((resolve, reject) => {
          let d = '';
          process.stdin.setEncoding('utf8');
          process.stdin.on('data', (c) => {
            d += c;
          });
          process.stdin.on('end', () => resolve(d));
          process.stdin.on('error', reject);
        })
      : await readFile(pathOrUrl, 'utf8');
  const res = validateReceiptFeed(text);
  if (!res.ok) {
    console.error(JSON.stringify(res));
    process.exit(1);
  }
  console.log(JSON.stringify(res));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

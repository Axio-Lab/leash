#!/usr/bin/env node
/**
 * Dual-protocol (x402 + MPP) smoke — runs targeted vitest files in dependency order.
 *
 * From repo root:
 *   node scripts/verify-dual-protocol.mjs
 *
 * CI-friendly: no devnet, no running API server (API tests use in-memory rigs).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const JOBS = [
  ['@leashmarket/schemas', 'tests/receipt-v02.test.ts'],
  ['@leashmarket/core', 'tests/payments-detect.test.ts'],
  ['@leashmarket/core', 'tests/mpp.test.ts'],
  ['@leashmarket/buyer-kit', 'tests/buyer-mpp.test.ts'],
  ['@leashmarket/seller-kit', 'tests/mpp-seller.test.ts'],
  ['@leashmarket/facilitator', 'tests/mpp-network.test.ts'],
  ['@leashmarket/facilitator', 'tests/http-server.test.ts'],
  ['@leashmarket/mcp-core', 'tests/tools.test.ts'],
  ['@leashmarket/api', 'tests/paywall.test.ts'],
  ['@leashmarket/api', 'tests/payment-links.test.ts'],
];

function fail(msg) {
  process.stderr.write(`\nverify-dual-protocol: FAIL — ${msg}\n`);
  process.exit(1);
}

process.stdout.write('verify-dual-protocol (x402 + MPP targeted tests)\n\n');

for (const [filter, rel] of JOBS) {
  process.stdout.write(`  → pnpm --filter ${filter} exec vitest run ${rel}\n`);
  const r = spawnSync('pnpm', ['--filter', filter, 'exec', 'vitest', 'run', rel], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    fail(`${filter} ${rel} exited ${r.status ?? 'unknown'}`);
  }
}

process.stdout.write('\nverify-dual-protocol: all checks passed.\n');

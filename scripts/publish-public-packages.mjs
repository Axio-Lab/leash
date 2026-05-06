#!/usr/bin/env node
/**
 * Publish @leashmarket/* public packages in dependency order.
 *
 * Prerequisite: `pnpm build` at repo root (each package needs `dist/`).
 *
 *   node scripts/publish-public-packages.mjs           # dry-run only
 *   node scripts/publish-public-packages.mjs --execute # real publish (npm auth required)
 *
 * Uses `pnpm publish` per package. Omit `--execute` to run with `--dry-run` only.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** Topological order: dependencies first (all use workspace:* locally). */
const PUBLISH_ORDER = [
  '@leashmarket/schemas',
  '@leashmarket/core',
  '@leashmarket/registry-utils',
  '@leashmarket/platform-auth',
  '@leashmarket/facilitator',
  '@leashmarket/seller-kit',
  '@leashmarket/buyer-kit',
  '@leashmarket/runner',
  '@leashmarket/sdk',
  '@leashmarket/mcp-core',
  '@leashmarket/mcp',
  '@leashmarket/cli',
];

const execute = process.argv.includes('--execute');
const extra = execute
  ? ['publish', '--access', 'public', '--no-git-checks']
  : ['publish', '--dry-run', '--no-git-checks'];

process.stdout.write(
  execute
    ? 'publish-public-packages: LIVE publish (--execute)\n\n'
    : 'publish-public-packages: dry-run only (pass --execute to publish)\n\n',
);

for (const name of PUBLISH_ORDER) {
  process.stdout.write(`  → pnpm --filter ${name} ${extra.join(' ')}\n`);
  const r = spawnSync('pnpm', ['--filter', name, ...extra], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    process.stderr.write(`\npublish-public-packages: FAILED on ${name} (exit ${r.status})\n`);
    process.exit(r.status ?? 1);
  }
}

process.stdout.write('\npublish-public-packages: done.\n');

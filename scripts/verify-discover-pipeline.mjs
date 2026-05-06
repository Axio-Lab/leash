#!/usr/bin/env node
/**
 * One-shot verification of the pay-skills → Leash API → discover merge.
 *
 * Checks (in order):
 *   1. Upstream `skills.json` (Google Cloud Storage index).
 *   2. `GET /v1/discover?capability=email&limit=5` on API_LOCAL (default :8801).
 *   3. Same URL on API_REMOTE — reads `LEASH_API_URL` from `apps/agents/.env`
 *      if present, else CLI env `API_REMOTE`, else same as local.
 *
 * Run from repo root:
 *   node scripts/verify-discover-pipeline.mjs
 *
 * On full success and when `--rm-self` is passed, this file deletes itself.
 * Default is to **keep** the script so `pnpm verify:discover` stays available.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const RM_SELF = process.argv.includes('--rm-self');

const API_LOCAL = process.env.API_LOCAL ?? 'http://127.0.0.1:8801';
const INDEX_URL =
  process.env.PAY_SKILLS_INDEX_URL ?? 'https://storage.googleapis.com/pay-skills/v1/skills.json';

function readLeashApiUrlFromAgentsEnv() {
  const p = path.join(REPO_ROOT, 'apps/agents/.env');
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  const m = text.match(/^\s*LEASH_API_URL=(.+)$/m);
  if (!m) return null;
  return m[1]
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .replace(/\/+$/, '');
}

const API_REMOTE = (process.env.API_REMOTE ?? readLeashApiUrlFromAgentsEnv() ?? API_LOCAL).replace(
  /\/+$/,
  '',
);

function fail(msg) {
  process.stderr.write(`\nverify-discover-pipeline: FAIL — ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  process.stdout.write(`  ok — ${msg}\n`);
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* noop */
  }
  return { res, text, json };
}

process.stdout.write('verify-discover-pipeline\n');
process.stdout.write(`  INDEX_URL=${INDEX_URL}\n`);
process.stdout.write(`  API_LOCAL=${API_LOCAL}\n`);
process.stdout.write(`  API_REMOTE=${API_REMOTE}\n\n`);

// [1] upstream index
{
  const { res, json } = await fetchJson(INDEX_URL);
  if (res.status !== 200) fail(`skills.json HTTP ${res.status}`);
  if (!json?.providers?.length) fail('skills.json: missing providers[]');
  ok(`skills.json (${json.providers.length} providers)`);
}

// [2] local discover merge
{
  const url = `${API_LOCAL}/v1/discover?capability=email&limit=8`;
  const { res, json } = await fetchJson(url);
  if (res.status !== 200) fail(`${url} → HTTP ${res.status}`);
  const items = Array.isArray(json?.items) ? json.items : [];
  const pay = items.filter((i) => i?.source === 'pay-skills');
  if (pay.length === 0) {
    fail(
      `${url} returned 0 pay-skills rows — restart apps/api so it loads the merged discover route:\n` +
        `  pnpm --filter @leash/api dev`,
    );
  }
  ok(`local /v1/discover (email): ${items.length} rows, ${pay.length} pay-skills`);
}

// [3] remote (agents .env LEASH_API_URL or same as local)
if (API_REMOTE !== API_LOCAL) {
  const url = `${API_REMOTE}/v1/discover?capability=email&limit=8`;
  const { res, json } = await fetchJson(url);
  if (res.status !== 200) fail(`${url} → HTTP ${res.status}`);
  const items = Array.isArray(json?.items) ? json.items : [];
  const pay = items.filter((i) => i?.source === 'pay-skills');
  if (pay.length === 0) {
    fail(
      `${url} returned 0 pay-skills rows — tunnel or remote API is stale. ` +
        `Point apps/agents/.env LEASH_API_URL at http://127.0.0.1:8801 when developing locally.`,
    );
  }
  ok(`remote /v1/discover (email): ${items.length} rows, ${pay.length} pay-skills`);
} else {
  ok('remote same as local (skipped duplicate)');
}

// [4] browse mode (no capability) — what Favorites uses on first paint
{
  const url = `${API_LOCAL}/v1/discover?limit=10`;
  const { res, json } = await fetchJson(url);
  if (res.status !== 200) fail(`${url} → HTTP ${res.status}`);
  const items = Array.isArray(json?.items) ? json.items : [];
  if (items.length === 0) fail('browse /v1/discover (no capability) returned 0 items');
  ok(`browse /v1/discover: ${items.length} rows`);
}

process.stdout.write('\nAll checks passed.\n');
process.stdout.write(
  'Favorites at http://localhost:4100/settings/favorites loads browse mode automatically — ensure\n' +
    '  apps/agents/.env has LEASH_API_URL=http://127.0.0.1:8801 (or a tunnel to that API).\n',
);

if (RM_SELF) {
  fs.unlinkSync(SCRIPT_PATH);
  process.stdout.write(`\nRemoved ${SCRIPT_PATH} (--rm-self).\n`);
}
process.exit(0);

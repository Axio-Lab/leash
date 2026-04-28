/**
 * Apply Turso/SQLite schema (same as API/indexer boot). Use when a worker
 * (e.g. agent-runtime) shares `LEASH_DB_URL` but you have not started the API yet.
 *
 * Env: `LEASH_DB_URL` + optional `LEASH_DB_AUTH_TOKEN` (agent-runtime),
 * or `LEASH_API_DB_URL` + optional `LEASH_API_DB_AUTH_TOKEN` (API .env).
 */

import { createClient } from '@libsql/client';

import { runMigrations } from '../src/storage/turso.js';

const url = (process.env.LEASH_DB_URL || process.env.LEASH_API_DB_URL || '').trim();
const authToken = (
  process.env.LEASH_DB_AUTH_TOKEN ||
  process.env.LEASH_API_DB_AUTH_TOKEN ||
  ''
).trim();

if (!url) {
  throw new Error('Set LEASH_DB_URL or LEASH_API_DB_URL');
}

const db = createClient({
  url,
  ...(authToken ? { authToken } : {}),
});

await runMigrations(db);
// eslint-disable-next-line no-console
console.log('[leash-db-migrate] schema up to date');

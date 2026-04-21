/**
 * In-memory endpoint store with optional append-only JSONL persistence.
 *
 * Endpoints are payment-link descriptors (see `EndpointV1` in
 * `@leash/schemas`). The runner stores them so that any caller can resolve
 * `https://<host>/x/<id>` from anywhere — not just the device that
 * created the link.
 *
 * The on-disk format is one JSON document per line:
 *   - lines that parse as `EndpointV1` are upserted by `id`
 *   - lines of the form `{"$delete": "<id>"}` remove an entry
 *
 * That gives us crash-safe persistence without an SQLite dependency, and
 * the file is human-inspectable / git-friendly. Production deployments can
 * swap this for a real database later.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { EndpointV1Schema, type EndpointV1 } from '@leash/schemas';

export type EndpointStore = {
  /** All endpoints currently known to the runner. */
  list(): EndpointV1[];
  /** Get a single endpoint by id, or `null` if missing. */
  get(id: string): EndpointV1 | null;
  /** Insert or update by id. Persists to disk if a `path` was configured. */
  upsert(endpoint: EndpointV1): EndpointV1;
  /** Remove by id. Persists to disk if a `path` was configured. */
  remove(id: string): boolean;
};

export type EndpointStoreOptions = {
  /** Optional JSONL file. Created if missing. Replayed on startup. */
  persistPath?: string | null;
};

export function createEndpointStore(opts: EndpointStoreOptions = {}): EndpointStore {
  const data = new Map<string, EndpointV1>();
  const persistPath = opts.persistPath ?? null;

  if (persistPath && existsSync(persistPath)) {
    const raw = readFileSync(persistPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed && typeof parsed === 'object' && '$delete' in parsed) {
        const id = (parsed as { $delete: unknown }).$delete;
        if (typeof id === 'string') data.delete(id);
        continue;
      }
      const endpoint = EndpointV1Schema.safeParse(parsed);
      if (endpoint.success) data.set(endpoint.data.id, endpoint.data);
    }
  }

  function persist(line: string): void {
    if (!persistPath) return;
    mkdirSync(dirname(persistPath), { recursive: true });
    appendFileSync(persistPath, line + '\n', 'utf8');
  }

  return {
    list() {
      return [...data.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    get(id) {
      return data.get(id) ?? null;
    },
    upsert(endpoint) {
      data.set(endpoint.id, endpoint);
      persist(JSON.stringify(endpoint));
      return endpoint;
    },
    remove(id) {
      const had = data.delete(id);
      if (had) persist(JSON.stringify({ $delete: id }));
      return had;
    },
  };
}

/**
 * Generate a URL-safe slug. Used when callers don't provide an `id`.
 *
 * Random 9-char base32-ish slug — collision probability is negligible for
 * the playground; the runner re-rolls on collision anyway.
 */
export function generateEndpointId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 9; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

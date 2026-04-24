/**
 * Boot helpers shared by the dev entrypoint and the CLI:
 *   - run DB migrations
 *   - register the optional `LEASH_API_BOOTSTRAP_KEY` once on first boot
 */

import { createApiKey, getApiKeyByPlaintext } from './storage/api-keys.js';
import { networkFromKey, type LeashApiConfig } from './config.js';
import type { DbClient } from './storage/turso.js';
import { runMigrations } from './storage/turso.js';

export async function boot(deps: { db: DbClient; config: LeashApiConfig }): Promise<void> {
  await runMigrations(deps.db);
  const seed = deps.config.bootstrapKey;
  if (seed) {
    const existing = await getApiKeyByPlaintext(deps.db, seed.value);
    if (!existing) {
      const network = networkFromKey(seed.value);
      await createApiKey(deps.db, {
        label: seed.label,
        network,
        plaintext: seed.value,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[leash-api] bootstrap api key registered for ${network} (label="${seed.label}")`,
      );
    }
  }
}

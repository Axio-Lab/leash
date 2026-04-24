/**
 * Hono `Variables` extension. The auth middleware sets these on every
 * authenticated request; route handlers read them via `c.var.*`.
 */

import type { ApiKeyRecord } from '../storage/api-keys.js';
import type { SvmNetwork } from '../util/network.js';

export type AuthVariables = {
  apiKey: ApiKeyRecord;
  network: SvmNetwork;
  /** Echoed onto event rows for per-customer attribution. */
  clientReference?: string;
};

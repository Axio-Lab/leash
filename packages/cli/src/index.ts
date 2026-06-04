/**
 * `@leashmarket/cli` programmatic surface.
 *
 * The package's primary use is the `leash` binary; the JS entry point
 * exists for future embeddability (e.g. running CLI commands in
 * tests without shelling out). For now we re-export the host
 * builder so callers can wire their own surfaces over the same
 * `LeashHost` the CLI uses internally.
 */

export { buildServerFromEnv, HostRef } from '@leashmarket/mcp';
export type { LeashHost, LeashToolResult } from '@leashmarket/mcp-core';

export const LEASH_CLI_VERSION = '0.3.3';

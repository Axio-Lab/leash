/**
 * Server-side helpers for talking to the local `@leashmarket/runner`.
 *
 * Thin re-export of `createRunnerClient` from `@leashmarket/runner` so every
 * Next API route shares the same typed client. Importers that want the
 * legacy `getHealth/getPause/getReceiptsJsonl` shape can keep using the
 * helper functions below; new code should prefer `runnerClient` directly.
 */

import { createRunnerClient, type RunnerHealth, type RunnerPause } from '@leashmarket/runner';
import { RUNNER_URL } from './env';

export const runnerClient = createRunnerClient({ url: RUNNER_URL });

export type { RunnerHealth, RunnerPause };

export async function getHealth(): Promise<RunnerHealth | { error: string }> {
  try {
    return await runnerClient.health();
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getPause(): Promise<RunnerPause | { error: string }> {
  try {
    return await runnerClient.pause();
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getReceiptsJsonl(mint: string): Promise<string> {
  return runnerClient.receipts.jsonl(mint);
}

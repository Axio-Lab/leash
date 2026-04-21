/**
 * Server-side helpers for talking to the local `@leash/runner`.
 * Used by Next API routes; never imported into client components directly.
 */

import { RUNNER_URL } from './env';

export type RunnerHealth = {
  ok: boolean;
  paused: boolean;
  source: 'env' | 'onchain' | 'cache';
};

export type RunnerPause = RunnerHealth & { env_kill: boolean };

export async function getHealth(): Promise<RunnerHealth | { error: string }> {
  try {
    const res = await fetch(`${RUNNER_URL}/health`, { cache: 'no-store' });
    if (!res.ok) return { error: `runner /health ${res.status}` };
    return (await res.json()) as RunnerHealth;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getPause(): Promise<RunnerPause | { error: string }> {
  try {
    const res = await fetch(`${RUNNER_URL}/pause`, { cache: 'no-store' });
    if (!res.ok) return { error: `runner /pause ${res.status}` };
    return (await res.json()) as RunnerPause;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getReceiptsJsonl(mint: string): Promise<string> {
  const res = await fetch(`${RUNNER_URL}/a/${mint}/receipts.jsonl`, { cache: 'no-store' });
  return res.text();
}

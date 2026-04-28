import type { Client } from '@libsql/client';

import { executeTask } from './executor.js';
import type { Publisher } from './publisher.js';
import { claimNextTask, getAgent, recordActivity, setTaskFinal } from './storage.js';

export type LoopDeps = {
  db: Client;
  publisher: Publisher;
  encryptionKey: string;
  pollMs: number;
  /** Test hook — return true to stop the loop after one tick. */
  shouldStop?: () => boolean;
  /** Test hook — invoked instead of `setTimeout` between polls. */
  sleep?: (ms: number) => Promise<void>;
};

export async function runOnce(deps: LoopDeps): Promise<{ ranTask: boolean }> {
  const task = await claimNextTask(deps.db);
  if (!task) return { ranTask: false };
  const agent = await getAgent(deps.db, task.agentMint);
  if (!agent) {
    const env = await recordActivity(deps.db, {
      taskId: task.id,
      agentMint: task.agentMint,
      type: 'error',
      payload: { message: 'agent missing or disabled' },
    });
    await deps.publisher.publish(env);
    await setTaskFinal(deps.db, task.id, 'failed', { error: 'agent missing or disabled' });
    return { ranTask: true };
  }
  await executeTask(
    {
      db: deps.db,
      publisher: deps.publisher,
      encryptionKey: deps.encryptionKey,
      stepDelayMs: 0,
    },
    agent,
    task,
  );
  return { ranTask: true };
}

export async function runLoop(deps: LoopDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (deps.shouldStop?.()) return;
    const { ranTask } = await runOnce(deps);
    if (!ranTask) {
      await sleep(deps.pollMs);
    }
  }
}

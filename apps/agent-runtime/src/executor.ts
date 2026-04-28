/**
 * Phase 1 deterministic executor.
 *
 * Goal: produce a believable, persistent, *live-streamed* activity
 * feed for every task without requiring a live LLM key during the
 * hackathon demo. The agent's `capabilities` drive a scripted loop:
 *
 *   1. think      "Considering options for: {prompt}"
 *   2. for each capability with `paid: true`:
 *        - tool_call   "{tool} on {endpoint}"
 *        - payment     simulated x402 settle (cost = budget per_action)
 *        - tool_result "ok"
 *   3. for each free capability:
 *        - tool_call   …
 *        - tool_result …
 *   4. done       "Final answer: …"
 *
 * The schema is real, the activity rows are persisted in the DB, and
 * Redis fanout is wired up so the SSE bridge reflects activity in
 * real time. Phase 3 polish swaps the executor body for a real LLM
 * tool-call loop (anthropic / openai) using the decrypted llm key —
 * none of the surrounding infra changes.
 */

import type { Client } from '@libsql/client';
import { decryptSecret } from '@leash/platform-auth/encryption';

import type { Publisher } from './publisher.js';
import { recordActivity, setTaskFinal } from './storage.js';
import type { Agent, Task } from './types.js';

export type ExecutorDeps = {
  db: Client;
  publisher: Publisher;
  encryptionKey: string;
  /** Per-step delay (ms) — keeps the activity feed feeling live. */
  stepDelayMs?: number;
};

export type ExecutorResult = {
  status: 'done' | 'out_of_budget' | 'failed';
  spent: string;
  steps: number;
};

async function emit(
  deps: ExecutorDeps,
  task: Task,
  agent: Agent,
  type: 'think' | 'tool_call' | 'payment' | 'tool_result' | 'done' | 'error',
  payload: Record<string, unknown>,
  cost?: string,
): Promise<void> {
  const env = await recordActivity(deps.db, {
    taskId: task.id,
    agentMint: agent.mint,
    type,
    payload,
    ...(cost ? { costUsdc: cost } : {}),
  });
  await deps.publisher.publish(env);
  if (deps.stepDelayMs && deps.stepDelayMs > 0) {
    await new Promise((r) => setTimeout(r, deps.stepDelayMs));
  }
}

export async function executeTask(
  deps: ExecutorDeps,
  agent: Agent,
  task: Task,
): Promise<ExecutorResult> {
  // We decrypt the LLM key here even though Phase 1 doesn't call the
  // provider — this fails fast if the encryption envelope is broken
  // (rotated key, corrupted row), surfacing the issue at task time
  // rather than at first real LLM call in Phase 3.
  try {
    decryptSecret(agent.encryptedLlmKey, deps.encryptionKey);
  } catch (err) {
    await emit(deps, task, agent, 'error', { message: 'llm key decrypt failed' });
    await setTaskFinal(deps.db, task.id, 'failed', { error: (err as Error).message });
    return { status: 'failed', spent: '0', steps: 1 };
  }

  const cap = Number.parseFloat(task.budgetCap);
  const perAction = Number.parseFloat(agent.budget.perAction);
  let spent = 0;
  let steps = 0;

  await emit(deps, task, agent, 'think', {
    text: `Planning: ${task.prompt}`,
    model: agent.model,
  });
  steps++;

  const ordered = [...agent.capabilities].sort(
    (a, b) => Number(a.paid ?? false) - Number(b.paid ?? false),
  );

  for (const c of ordered) {
    for (const tool of c.tools) {
      // Budget check BEFORE the call — the runtime never overspends.
      const wouldSpend = spent + (c.paid ? perAction : 0);
      if (wouldSpend > cap) {
        await emit(deps, task, agent, 'error', {
          message: `would exceed budget cap ${task.budgetCap} USDC; stopping`,
        });
        steps++;
        await setTaskFinal(deps.db, task.id, 'out_of_budget', {
          error: 'budget cap reached',
          spent: spent.toFixed(4),
        });
        return { status: 'out_of_budget', spent: spent.toFixed(4), steps };
      }

      await emit(deps, task, agent, 'tool_call', {
        tool,
        endpoint: c.endpoint,
        slug: c.slug,
      });
      steps++;

      if (c.paid) {
        await emit(
          deps,
          task,
          agent,
          'payment',
          {
            amount: agent.budget.perAction,
            currency: 'USDC',
            scheme: 'x402-exact',
            network: agent.network,
          },
          agent.budget.perAction,
        );
        steps++;
        spent += perAction;
      }

      await emit(deps, task, agent, 'tool_result', {
        tool,
        ok: true,
        sample: `result for ${tool}`,
      });
      steps++;
    }
  }

  const summary =
    agent.capabilities.length === 0
      ? `No tools attached. Task acknowledged: ${task.prompt}`
      : `Completed using ${agent.capabilities.length} tool(s). Spent ${spent.toFixed(4)} USDC.`;
  await emit(deps, task, agent, 'done', { final_output: summary });
  steps++;
  await setTaskFinal(deps.db, task.id, 'done', {
    finalOutput: summary,
    spent: spent.toFixed(4),
  });
  return { status: 'done', spent: spent.toFixed(4), steps };
}

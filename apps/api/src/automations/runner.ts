import type { LeashApiConfig } from '../config.js';
import {
  claimNextDueAutomation,
  createAutomationRunWithState,
  finishAutomationRun,
  pruneExpiredAutomationRuns,
  releaseAutomationClaim,
  type AutomationDeliveryPolicy,
  type AutomationRow,
  type AutomationRunStatus,
} from '../storage/automations.js';
import type { DbClient } from '../storage/turso.js';
import { deliverAutomationReport } from './reports.js';
import { computeNextRunAt } from './schedule.js';

export type AutomationSchedulerOptions = {
  workerId?: string;
  lockMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type AutomationSchedulerResult = {
  claimed: boolean;
  automationId?: string;
  runId?: string;
  status?: 'succeeded' | 'failed' | 'skipped';
  error?: string;
};

export type AutomationRunNowOptions = {
  triggerPayload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  claimedBy?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  nextRunAt?: string | null;
};

export type AutomationWorkerHandle = {
  stop: () => void;
};

function selectedToolkits(automation: AutomationRow): string[] {
  const raw = automation.sourceConfig.toolkit_slugs;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter((s) => s.trim().length > 0))].sort();
}

function deliveryStatusFor(policy: AutomationDeliveryPolicy): string {
  switch (policy) {
    case 'every_run':
    case 'on_failure':
    case 'on_condition':
      return 'pending';
    case 'silent':
      return 'suppressed';
    case 'history_only':
    default:
      return 'history_only';
  }
}

function parseBffResponse(text: string): {
  text: string;
  artifacts: unknown[];
  errors: string[];
  warnings: string[];
  model?: string;
} {
  if (!text) return { text: '', artifacts: [], errors: [], warnings: [] };
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    model: typeof parsed.model === 'string' ? parsed.model : undefined,
  };
}

async function invokeAutomationBff(args: {
  config: LeashApiConfig;
  automation: AutomationRow;
  runId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}) {
  if (!args.config.agentsBffUrl || !args.config.agentsBffSecret) {
    throw new Error('agents BFF is not configured for automation execution');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const res = await args.fetchImpl(`${args.config.agentsBffUrl}/api/agents/automation-run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${args.config.agentsBffSecret}`,
        'content-type': 'application/json',
        'x-leash-trace': `automation:${args.runId}`,
      },
      body: JSON.stringify({
        owner_privy_id: args.automation.ownerPrivyId,
        agent_mint: args.automation.agentMint,
        automation_id: args.automation.id,
        run_id: args.runId,
        name: args.automation.name,
        description: args.automation.description,
        instructions: args.automation.instructions,
        trigger_type: args.automation.triggerType,
        trigger_config: args.automation.triggerConfig,
        source_config: args.automation.sourceConfig,
        delivery_policy: args.automation.deliveryPolicy,
        delivery_config: args.automation.deliveryConfig,
      }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text.slice(0, 500) || `agents BFF returned HTTP ${res.status}`);
    const parsed = parseBffResponse(text);
    if (parsed.errors.length > 0) throw new Error(parsed.errors.join('; '));
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function terminalStatus(status: AutomationRunStatus): 'succeeded' | 'failed' | 'skipped' | null {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'skipped' || status === 'cancelled') return 'skipped';
  return null;
}

export async function runAutomationNow(
  db: DbClient,
  config: LeashApiConfig,
  automation: AutomationRow,
  options: AutomationRunNowOptions = {},
): Promise<Omit<AutomationSchedulerResult, 'claimed'> & { duplicate: boolean }> {
  let runId: string | undefined;
  try {
    const { run, created } = await createAutomationRunWithState(db, {
      automationId: automation.id,
      ownerPrivyId: automation.ownerPrivyId,
      agentMint: automation.agentMint,
      triggerType: automation.triggerType,
      triggerPayload: options.triggerPayload ?? {},
      status: 'running',
      idempotencyKey: options.idempotencyKey ?? null,
      claimedBy: options.claimedBy ?? null,
    });
    runId = run.id;
    if (!created) {
      return {
        automationId: automation.id,
        runId,
        status: terminalStatus(run.status) ?? 'skipped',
        duplicate: true,
      };
    }

    const bff = await invokeAutomationBff({
      config,
      automation,
      runId,
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
    const finishedAt = new Date();
    const nextRunAt =
      options.nextRunAt !== undefined
        ? options.nextRunAt
        : computeNextRunAt(automation, finishedAt);
    const delivery = await deliverAutomationReport(
      {
        automation,
        runId,
        status: 'succeeded',
        outputText: bff.text,
        triggerPayload: options.triggerPayload,
        artifacts: bff.artifacts,
      },
      { fetchImpl: options.fetchImpl },
    );
    await finishAutomationRun(db, {
      runId,
      automationId: automation.id,
      status: 'succeeded',
      outputText: bff.text,
      sourceSummary: {
        toolkits: selectedToolkits(automation),
        model: bff.model ?? null,
        warnings: bff.warnings,
      },
      deliveryStatus: delivery.status || deliveryStatusFor(automation.deliveryPolicy),
      deliveryResult: delivery.result,
      receipts: bff.artifacts,
      nextRunAt,
      finishedAt: finishedAt.toISOString(),
    });
    return { automationId: automation.id, runId, status: 'succeeded', duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      const finishedAt = new Date();
      const nextRunAt =
        options.nextRunAt !== undefined
          ? options.nextRunAt
          : computeNextRunAt(automation, finishedAt);
      const delivery = await deliverAutomationReport(
        {
          automation,
          runId,
          status: 'failed',
          error: message,
          triggerPayload: options.triggerPayload,
        },
        { fetchImpl: options.fetchImpl },
      );
      await finishAutomationRun(db, {
        runId,
        automationId: automation.id,
        status: 'failed',
        error: message,
        sourceSummary: { toolkits: selectedToolkits(automation) },
        deliveryStatus: delivery.status || deliveryStatusFor(automation.deliveryPolicy),
        deliveryResult: delivery.result,
        nextRunAt,
        finishedAt: finishedAt.toISOString(),
      });
    }
    return {
      automationId: automation.id,
      runId,
      status: 'failed',
      error: message,
      duplicate: false,
    };
  }
}

export async function runAutomationSchedulerOnce(
  db: DbClient,
  config: LeashApiConfig,
  options: AutomationSchedulerOptions = {},
): Promise<AutomationSchedulerResult> {
  const now = options.now ?? new Date();
  const workerId = options.workerId ?? `automation-worker:${process.pid}`;
  const automation = await claimNextDueAutomation(db, {
    workerId,
    now: now.toISOString(),
    lockMs: options.lockMs,
  });
  if (!automation) return { claimed: false };

  const result = await runAutomationNow(db, config, automation, {
    triggerPayload: {
      scheduled_for: automation.nextRunAt,
      claimed_at: now.toISOString(),
    },
    idempotencyKey: `schedule:${automation.nextRunAt ?? now.toISOString()}`,
    claimedBy: workerId,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (result.status === 'skipped' || !result.runId) {
    await releaseAutomationClaim(db, automation.id, workerId);
  }
  return { claimed: true, ...result };
}

export function startAutomationWorker(
  db: DbClient,
  config: LeashApiConfig,
  intervalMs = config.automationPollMs,
  options: AutomationSchedulerOptions = {},
): AutomationWorkerHandle {
  if (!config.automationsEnabled) {
    return { stop: () => undefined };
  }
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await runAutomationSchedulerOnce(db, config, options);
      await pruneExpiredAutomationRuns(db);
    } catch {
      // Keep the worker alive; individual run failures are persisted.
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, Math.max(250, intervalMs));
  return {
    stop: () => {
      stopped = true;
    },
  };
}

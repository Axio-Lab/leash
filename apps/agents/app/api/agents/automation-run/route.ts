/**
 * `POST /api/agents/automation-run` — admin-secret-gated entrypoint
 * for apps/api's automation scheduler.
 *
 * This is deliberately separate from `/api/agents/run`: background
 * automations need stricter prompts, scoped connections, and a stable
 * run id so history in apps/api can point at one exact execution.
 */

import { timingSafeEqual } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { DEFAULT_AGENT_SETTINGS, getAgentSettings } from '@/lib/agents/agent-settings';
import { runAgentTurn } from '@/lib/agents/brain';
import { defaultSkillFragments } from '@/lib/agents/default-skills';
import { resolveMcpServers } from '@/lib/agents/tool-registry';
import type { AgentEvent } from '@/lib/agents/types';
import { getServerEnv, resolveAgentModel } from '@/lib/env';

export const runtime = 'nodejs';

const JsonObjectSchema = z.record(z.unknown());

const AutomationRunBodySchema = z.object({
  owner_privy_id: z.string().min(1),
  agent_mint: z.string().min(1),
  automation_id: z.string().min(1),
  run_id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  instructions: z.string().min(1).max(8000),
  trigger_type: z.enum(['schedule', 'webhook', 'event']),
  trigger_config: JsonObjectSchema.default({}),
  source_config: JsonObjectSchema.default({}),
  delivery_policy: z
    .enum(['history_only', 'every_run', 'on_failure', 'on_condition', 'silent'])
    .default('history_only'),
  delivery_config: JsonObjectSchema.default({}),
  model: z.string().optional(),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    const pad = Buffer.alloc(ab.length, 0);
    timingSafeEqual(ab, pad);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function checkAdminAuth(req: NextRequest): { ok: boolean; reason?: string } {
  const env = getServerEnv();
  const expected = env.agentsAdminSecret;
  if (!expected || expected.length === 0) {
    return { ok: false, reason: 'agents_admin_secret_not_configured' };
  }
  const auth = req.headers.get('authorization');
  const direct = req.headers.get('x-agents-admin-secret');
  let provided: string | null = null;
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) provided = m[1].trim();
  }
  if (!provided && direct) provided = direct.trim();
  if (!provided) return { ok: false, reason: 'missing_admin_secret' };
  if (!safeEqual(provided, expected)) return { ok: false, reason: 'invalid_admin_secret' };
  return { ok: true };
}

async function fetchAgentRow(agentMint: string): Promise<{
  ownerWallet: string | null;
  systemPrompt: string | null;
} | null> {
  try {
    const env = getServerEnv();
    const res = await fetch(
      `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(agentMint)}`,
      { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { owner_wallet?: string; system_prompt?: string };
    return {
      ownerWallet: typeof json.owner_wallet === 'string' ? json.owner_wallet : null,
      systemPrompt: typeof json.system_prompt === 'string' ? json.system_prompt : null,
    };
  } catch {
    return null;
  }
}

function enabledToolkits(sourceConfig: Record<string, unknown>): string[] {
  const raw = sourceConfig.toolkit_slugs;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter((s) => s.trim().length > 0))].sort();
}

function buildAutomationPrompt(body: z.infer<typeof AutomationRunBodySchema>): string {
  const toolkits = enabledToolkits(body.source_config);
  return [
    'SYSTEM: Background automation run. Complete the task without asking follow-up questions.',
    `Automation: ${body.name}`,
    body.description ? `Description: ${body.description}` : null,
    `Trigger: ${body.trigger_type}`,
    `Trigger config: ${JSON.stringify(body.trigger_config)}`,
    `Allowed connected data sources: ${toolkits.length > 0 ? toolkits.join(', ') : 'none selected'}`,
    `Report policy: ${body.delivery_policy}`,
    '',
    'Instructions:',
    body.instructions,
    '',
    'Execution rules:',
    '- Use only the selected connected data sources plus Leash account tools.',
    '- Produce a concise run report with findings, actions taken, and anything that needs human attention.',
    '- Do not request withdrawals, delegation changes, spend-limit changes, or destructive account actions.',
    '- If a payment card is required, include it in the report instead of asking the user to confirm during this run.',
  ]
    .filter((line): line is string => line != null)
    .join('\n');
}

type Artifact = {
  kind: 'payment_link' | 'payment_request' | 'withdraw_request' | 'receipt' | 'tool_call';
  payload: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const trace = req.headers.get('x-leash-trace')?.trim() || '—';

  const auth = checkAdminAuth(req);
  if (!auth.ok) {
    const status = auth.reason === 'agents_admin_secret_not_configured' ? 503 : 401;
    console.warn(`[agents:automation-run] trace=${trace} auth_failed reason=${auth.reason}`);
    return new Response(JSON.stringify({ error: 'unauthorized', reason: auth.reason }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const raw = await req.json().catch(() => null);
  const parsed = AutomationRunBodySchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[agents:automation-run] trace=${trace} invalid_request`);
    return new Response(
      JSON.stringify({ error: 'invalid_request', details: parsed.error.flatten() }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  const body = parsed.data;

  const agentRow = await fetchAgentRow(body.agent_mint);
  const baseSystemPrompt = agentRow?.systemPrompt ?? '';
  const systemPrompt = [
    baseSystemPrompt,
    defaultSkillFragments(),
    'Automation mode: finish the configured task in one pass, write an audit-friendly report, and never wait for interactive user approval.',
  ]
    .filter((s) => s && s.length > 0)
    .join('\n\n');

  const settings = await getAgentSettings(body.owner_privy_id).catch(() => DEFAULT_AGENT_SETTINGS);
  const effectiveModel = body.model?.trim() || resolveAgentModel(settings.tier);
  const allowedToolkits = enabledToolkits(body.source_config);
  const mcpServers = await resolveMcpServers({
    privyId: body.owner_privy_id,
    agentMint: body.agent_mint,
    ownerWallet: agentRow?.ownerWallet ?? null,
    enabledToolkits: allowedToolkits,
  });

  let text = '';
  const artifacts: Artifact[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const iter = runAgentTurn({
      privyId: body.owner_privy_id,
      threadId: `automation:${body.automation_id}:${body.run_id}`,
      agentMint: body.agent_mint,
      userPrompt: buildAutomationPrompt(body),
      model: effectiveModel,
      systemPrompt,
      mcpServers,
    });
    for await (const ev of iter as AsyncIterable<AgentEvent>) {
      switch (ev.type) {
        case 'token':
          text += ev.text;
          break;
        case 'artifact':
          artifacts.push(ev.artifact as Artifact);
          break;
        case 'error':
          errors.push(ev.message);
          break;
        case 'warning':
          warnings.push(ev.message);
          break;
        default:
          break;
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  console.log(
    `[agents:automation-run] trace=${trace} done automation=${body.automation_id} run=${body.run_id} textLen=${text.trim().length} artifacts=${artifacts.length} errors=${errors.length}`,
  );

  return new Response(
    JSON.stringify({
      text: text.trim(),
      artifacts,
      errors,
      warnings,
      agent_mint: body.agent_mint,
      model: effectiveModel,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

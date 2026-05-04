/**
 * `POST /api/agents/run` — admin-secret-gated, server-to-server entry
 * into the same agent loop the in-app chat uses.
 *
 * Used by the apps/api Telegram (and Phase 2 WhatsApp) dispatcher to
 * run a turn on behalf of a user *without* an interactive Privy
 * session — the dispatcher already authenticated the user upstream via
 * the bound `external_connections.bound_chat_id` filter.
 *
 * Request body:
 *   {
 *     owner_privy_id: string,
 *     agent_mint?: string,
 *     channel: 'telegram' | 'whatsapp',
 *     message: string,
 *     conversation?: Array<{role: 'user'|'assistant'|'system', content: string}>,
 *     model?: string,
 *   }
 *
 * Response:
 *   {
 *     text: string,                                   // assistant's final reply
 *     artifacts: Array<{kind, payload}>,              // pay/withdraw/etc cards
 *     errors: string[],
 *     warnings: string[],
 *   }
 *
 * The endpoint is intentionally non-streaming: external channels post
 * one reply per turn, so we aggregate token deltas server-side and
 * return the joined text in one shot. Streaming would force the
 * dispatcher to either chunk-edit Telegram messages (rate-limit hostile)
 * or buffer anyway.
 */

import { timingSafeEqual } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { DEFAULT_AGENT_SETTINGS, getAgentSettings } from '@/lib/agents/agent-settings';
import { runAgentTurn } from '@/lib/agents/brain';
import { resolveMcpServers } from '@/lib/agents/tool-registry';
import { defaultSkillFragments } from '@/lib/agents/default-skills';
import type { AgentEvent } from '@/lib/agents/types';
import { getServerEnv, resolveAgentModel } from '@/lib/env';

export const runtime = 'nodejs';

const RunBodySchema = z.object({
  owner_privy_id: z.string().min(1),
  agent_mint: z.string().optional(),
  channel: z.enum(['telegram', 'whatsapp']),
  message: z.string().min(1).max(8000),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .max(40)
    .optional(),
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

async function resolvePrimaryAgentMint(privyId: string): Promise<string | null> {
  try {
    const env = getServerEnv();
    const res = await fetch(
      `${env.leashApiUrl}/v1/platform/agents?owner_privy_id=${encodeURIComponent(privyId)}`,
      { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: Array<{ mint?: string }> };
    const first = json.items?.find((a) => typeof a.mint === 'string' && a.mint.length > 0);
    return first?.mint ?? null;
  } catch {
    return null;
  }
}

function buildTranscript(
  message: string,
  conversation: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> | undefined,
  channel: 'telegram' | 'whatsapp',
): string {
  // Channel context is appended as a system-flavoured prelude so the
  // model knows it's replying through Telegram/WhatsApp and should
  // keep responses short + use channel-friendly formatting (no large
  // tables, no images). The dispatcher does the actual format/escape
  // pass — this just nudges the model.
  const channelHint =
    channel === 'telegram'
      ? 'Reply concisely (≤ 2 short paragraphs). Telegram formatting only — *bold*, _italic_, `code` blocks. Avoid wide tables.'
      : 'Reply concisely. WhatsApp formatting only — *bold*, _italic_, ```code```. Avoid wide tables.';
  const lines: string[] = [`SYSTEM: ${channelHint}`];
  if (conversation && conversation.length > 0) {
    for (const turn of conversation) {
      lines.push(`${turn.role.toUpperCase()}: ${turn.content}`);
    }
  }
  lines.push(`USER: ${message}`);
  return lines.join('\n\n');
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
    // eslint-disable-next-line no-console
    console.warn(`[agents:run] trace=${trace} auth_failed reason=${auth.reason}`);
    return new Response(JSON.stringify({ error: 'unauthorized', reason: auth.reason }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const raw = await req.json().catch(() => null);
  const parsed = RunBodySchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(`[agents:run] trace=${trace} invalid_request`);
    return new Response(
      JSON.stringify({ error: 'invalid_request', details: parsed.error.flatten() }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  const body = parsed.data;

  // eslint-disable-next-line no-console
  console.log(
    `[agents:run] trace=${trace} start owner=${body.owner_privy_id} channel=${body.channel} msgLen=${body.message.length}`,
  );

  // Resolve the agent (passed in or first one for the user) up front
  // so we can hydrate the system prompt + owner wallet for the chat
  // host. Same code path as `app/api/agents/chat/route.ts`.
  const agentMint = body.agent_mint ?? (await resolvePrimaryAgentMint(body.owner_privy_id));
  if (!agentMint) {
    // eslint-disable-next-line no-console
    console.warn(
      `[agents:run] trace=${trace} no_agent_mint owner=${body.owner_privy_id} — create an agent in Leash first`,
    );
  }
  const agentRow = agentMint ? await fetchAgentRow(agentMint) : null;
  const ownerWallet = agentRow?.ownerWallet ?? null;
  const baseSystemPrompt = agentRow?.systemPrompt ?? '';
  const systemPrompt = [baseSystemPrompt, defaultSkillFragments()]
    .filter((s) => s && s.length > 0)
    .join('\n\n');

  const settings = await getAgentSettings(body.owner_privy_id).catch(() => DEFAULT_AGENT_SETTINGS);
  const effectiveModel = body.model?.trim() || resolveAgentModel(settings.tier);

  const mcpServers = await resolveMcpServers({
    privyId: body.owner_privy_id,
    agentMint: agentMint ?? null,
    ownerWallet,
  });

  const transcript = buildTranscript(body.message, body.conversation, body.channel);

  let text = '';
  const artifacts: Artifact[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const iter = runAgentTurn({
      privyId: body.owner_privy_id,
      threadId: `external:${body.channel}:${agentMint ?? 'no-agent'}`,
      agentMint: agentMint ?? null,
      userPrompt: transcript,
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
        // tool_use / tool_result / done — discarded for non-streaming reply.
        default:
          break;
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  // eslint-disable-next-line no-console
  console.log(
    `[agents:run] trace=${trace} done agent_mint=${agentMint ?? 'null'} model=${effectiveModel} textLen=${text.trim().length} artifacts=${artifacts.length} errors=${errors.length} warnings=${warnings.length}`,
  );

  return new Response(
    JSON.stringify({
      text: text.trim(),
      artifacts,
      errors,
      warnings,
      agent_mint: agentMint,
      model: effectiveModel,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

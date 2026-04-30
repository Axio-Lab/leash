import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { getServerEnv } from '@/lib/env';

import { resolveAnthropicKey } from './llm-keys';
import { recordTurnUsage } from './usage';
import type { AgentEvent } from './types';

export type BrainRunContext = {
  privyId: string;
  threadId: string;
  agentMint?: string | null;
  /** Full transcript (ROLE: content lines) or a single user message. */
  userPrompt: string;
  attachments?: Array<{
    name: string;
    mime: string;
    size: number;
    dataBase64: string;
  }>;
  model: string;
  systemPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
};

const STUB_REPLY =
  'Got it — deterministic stub reply (no ANTHROPIC_API_KEY). Same prompt → same text.';

/**
 * Set `LEASH_AGENT_STUB=1` (only in tests / fully offline dev) to force the
 * deterministic stub. In normal dev/prod we surface the underlying key error
 * to the user instead of silently echoing the prompt.
 */
function stubModeEnabled(): boolean {
  const v = process.env.LEASH_AGENT_STUB;
  return v === '1' || v === 'true';
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out.length ? out : [''];
}

async function* runStubTurn(ctx: BrainRunContext): AsyncGenerator<AgentEvent> {
  const combined = `${STUB_REPLY} (${ctx.userPrompt.slice(0, 48)})`;
  for (const chunk of chunkText(combined, 36)) {
    yield { type: 'token', text: chunk };
  }
  yield { type: 'done' };
}

export async function* runAgentTurn(ctx: BrainRunContext): AsyncGenerator<AgentEvent> {
  let resolution: Awaited<ReturnType<typeof resolveAnthropicKey>>;
  try {
    resolution = await resolveAnthropicKey(ctx.privyId);
  } catch (err) {
    if (stubModeEnabled()) {
      yield* runStubTurn(ctx);
      return;
    }
    const message =
      err instanceof Error
        ? err.message
        : 'Anthropic API key is not configured for this environment.';
    yield { type: 'error', message };
    yield { type: 'done' };
    return;
  }

  const env = getServerEnv();
  const model = ctx.model || env.leashAgentModel;
  const prompt = ctx.systemPrompt
    ? `${ctx.systemPrompt}\n\nConversation:\n${ctx.userPrompt}`
    : ctx.userPrompt;
  const attachmentContext = buildAttachmentContext(ctx.attachments ?? []);
  const finalPrompt = attachmentContext.length > 0 ? `${prompt}\n\n${attachmentContext}` : prompt;

  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  const mcpCalls = Object.keys(ctx.mcpServers ?? {}).length;

  const q = query({
    prompt: finalPrompt,
    options: {
      cwd: '/tmp',
      settingSources: [],
      model,
      tools: [],
      mcpServers: ctx.mcpServers ?? {},
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
        ),
        ANTHROPIC_API_KEY: resolution.apiKey,
      },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
  });

  let sawSuccess = false;
  try {
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') {
        sawSuccess = true;
        const u = msg.usage as Record<string, unknown>;
        inputTokens = Number(u.input_tokens ?? u.inputTokens ?? 0);
        outputTokens = Number(u.output_tokens ?? u.outputTokens ?? 0);
        const text = typeof msg.result === 'string' ? msg.result : '';
        if (text.length > 0) {
          for (const chunk of chunkText(text, 48)) {
            yield { type: 'token', text: chunk };
          }
        }
      }
      if (msg.type === 'result' && msg.subtype !== 'success') {
        const errs = 'errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('; ') : 'error';
        yield { type: 'error', message: errs };
      }
      // Mirror tool results into UI artifacts. The Claude SDK yields
      // `user`-typed messages whose content blocks include `tool_result`
      // entries when an MCP tool finished. We pluck out our well-known
      // shapes (payment_link, treasury_balance, marketplace_tool, …)
      // and emit `artifact` events so the chat UI always renders the
      // correct card regardless of what the assistant text says.
      const artifact = extractArtifact(msg);
      if (artifact) yield { type: 'artifact', artifact };
    }
  } finally {
    q.close();
  }

  if (!sawSuccess) {
    yield { type: 'warning', message: 'Session ended without a final result payload.' };
  }

  yield { type: 'done' };

  await recordTurnUsage({
    privyId: ctx.privyId,
    agentMint: ctx.agentMint,
    threadId: ctx.threadId,
    model,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - started,
    mcpCalls,
    paidBy: resolution.paidBy,
  });
}

/**
 * Pluck a UI artifact out of a Claude SDK message. We currently surface:
 *
 *   - `payment_link`     — emitted by `leash_create_payment_link` so the
 *     UI renders a clickable URL + QR code even if the assistant text
 *     forgets to quote it back.
 *   - `payment_request`  — emitted by `leash_pay_payment_link` so the UI
 *     renders a "Pay" card. The actual settlement happens in the browser
 *     using the Privy operator wallet (see `artifact-card.tsx`).
 *   - `withdraw_request`  — emitted by `leash_withdraw_treasury` so the UI
 *     renders a "Withdraw" card. The owner-driven `mpl-core::Execute`
 *     gets signed in the browser via Privy + `usePrivyUmi`; the server
 *     never holds the operator key.
 *
 * Returns `null` for anything we don't visualise.
 */
function extractArtifact(msg: unknown): {
  kind: 'payment_link' | 'payment_request' | 'withdraw_request';
  payload: Record<string, unknown>;
} | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'user') return null;
  const message = m.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type !== 'tool_result') continue;
    const inner = b.content;
    const text = Array.isArray(inner)
      ? inner
          .map((entry) =>
            entry && typeof entry === 'object' && (entry as { text?: unknown }).text
              ? String((entry as { text?: unknown }).text)
              : '',
          )
          .join('')
      : typeof inner === 'string'
        ? inner
        : '';
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const payload = parsed as Record<string, unknown>;
    if (payload.kind === 'payment_link' && payload.status === 'ok') {
      return {
        kind: 'payment_link',
        payload: {
          url: payload.url,
          id: payload.id,
          amount: payload.price,
          currency: payload.currency,
          label: payload.label,
          network: payload.network,
        },
      };
    }
    if (payload.kind === 'payment_request' && payload.status === 'ok') {
      return {
        kind: 'payment_request',
        payload: {
          url: payload.url,
          agent_mint: payload.agent_mint,
          preview: payload.preview,
        },
      };
    }
    if (payload.kind === 'withdraw_request' && payload.status === 'ok') {
      return {
        kind: 'withdraw_request',
        payload: {
          agent_mint: payload.agent_mint,
          token: payload.token,
          mint: payload.mint,
          token_program: payload.token_program,
          decimals: payload.decimals,
          amount: payload.amount,
          amount_atomic: payload.amount_atomic,
          destination: payload.destination,
          network: payload.network,
        },
      };
    }
  }
  return null;
}

function buildAttachmentContext(attachments: BrainRunContext['attachments']): string {
  if (!attachments || attachments.length === 0) return '';
  const lines: string[] = ['User attached files to this turn:'];
  for (const a of attachments) {
    if (a.mime.startsWith('image/')) {
      lines.push(
        `- Image "${a.name}" (${a.mime}, ${a.size} bytes), base64 payload:\n${a.dataBase64}`,
      );
    } else if (
      a.mime.startsWith('text/') ||
      /\.(md|txt|json|csv|ts|tsx|js|jsx|py|rs|sol)$/i.test(a.name)
    ) {
      const text = Buffer.from(a.dataBase64, 'base64').toString('utf8').slice(0, 16_000);
      lines.push(`- Text file "${a.name}" (${a.mime}, ${a.size} bytes):\n\`\`\`\n${text}\n\`\`\``);
    } else {
      lines.push(
        `- Binary file "${a.name}" (${a.mime || 'application/octet-stream'}, ${a.size} bytes).`,
      );
    }
  }
  return lines.join('\n');
}

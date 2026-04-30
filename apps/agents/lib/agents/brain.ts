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

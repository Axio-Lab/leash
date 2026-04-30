import { z } from 'zod';
import { type NextRequest } from 'next/server';

import { runAgentTurn } from '@/lib/agents/brain';
import { mergeSkillFragmentsHeader, resolveMcpServers } from '@/lib/agents/tool-registry';
import type { AgentEvent } from '@/lib/agents/types';
import { sseEncode } from '@/lib/agents/sse';
import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

const ChatBodySchema = z.object({
  threadId: z.string().min(1),
  agentMint: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .min(1),
  model: z.string().optional(),
});

function buildTranscript(messages: z.infer<typeof ChatBodySchema>['messages']): string {
  const lines = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`);
  return lines.join('\n\n');
}

type UploadedAttachment = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
};

async function parseRequestPayload(req: NextRequest): Promise<{
  parsed: z.SafeParseReturnType<unknown, z.infer<typeof ChatBodySchema>>;
  attachments: UploadedAttachment[];
}> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const rawPayload = form.get('payload');
    let payload: unknown = null;
    if (typeof rawPayload === 'string') {
      payload = JSON.parse(rawPayload);
    }
    const attachments: UploadedAttachment[] = [];
    for (const entry of form.getAll('attachments')) {
      if (!(entry instanceof File)) continue;
      if (entry.size <= 0) continue;
      const bytes = new Uint8Array(await entry.arrayBuffer());
      attachments.push({
        name: entry.name,
        mime: entry.type || 'application/octet-stream',
        size: entry.size,
        dataBase64: Buffer.from(bytes).toString('base64'),
      });
    }
    return { parsed: ChatBodySchema.safeParse(payload), attachments };
  }
  const raw = await req.json().catch(() => null);
  return { parsed: ChatBodySchema.safeParse(raw), attachments: [] };
}

async function fetchAgentSystemPrompt(agentMint: string): Promise<string | undefined> {
  try {
    const env = getServerEnv();
    const res = await fetch(
      `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(agentMint)}`,
      { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
    );
    if (!res.ok) return undefined;
    const agent = (await res.json()) as { system_prompt?: string };
    return typeof agent.system_prompt === 'string' ? agent.system_prompt : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { parsed, attachments } = await parseRequestPayload(req);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'invalid_request', details: parsed.error.flatten() }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  const { threadId, agentMint, messages, model } = parsed.data;
  const transcript = buildTranscript(messages);

  let systemPrompt: string | undefined;
  if (agentMint) {
    systemPrompt = await fetchAgentSystemPrompt(agentMint);
  }

  const skillExtras = mergeSkillFragmentsHeader(req.headers.get('x-leash-skills'));
  if (skillExtras) {
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${skillExtras}` : skillExtras;
  }

  const env = getServerEnv();
  const effectiveModel = model?.trim() || env.leashAgentModel;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (ev: AgentEvent) => {
        try {
          controller.enqueue(sseEncode(ev));
        } catch {
          /* closed */
        }
      };

      try {
        const mcpServers = await resolveMcpServers({
          privyId: session.privyId,
          agentMint: agentMint ?? null,
          ownerWallet: session.wallet ?? null,
        });
        const iter = runAgentTurn({
          privyId: session.privyId,
          threadId,
          agentMint: agentMint ?? null,
          userPrompt: transcript,
          attachments,
          model: effectiveModel,
          systemPrompt,
          mcpServers,
        });
        for await (const ev of iter) {
          push(ev);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        push({ type: 'error', message });
        push({ type: 'done' });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

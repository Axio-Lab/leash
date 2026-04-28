import { type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { createDedicatedSubscriber } from '@/lib/redis';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/tasks/{id}/stream` — Server-Sent Events for a single task.
 *
 * 1. Verify the user owns the task's agent (via `apps/api`).
 * 2. Replay every persisted activity row.
 * 3. Subscribe to `leash:activity:{id}` on Redis and forward events.
 *
 * Without Redis configured we still send the replay then close the
 * connection — the activity feed page falls back to polling.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return new Response('unauthenticated', { status: 401 });
  const { id } = await params;
  const env = getServerEnv();

  const taskRes = await fetch(`${env.leashApiUrl}/v1/platform/tasks/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
  });
  if (!taskRes.ok) return new Response('not found', { status: 404 });
  const task = (await taskRes.json()) as { agent_mint: string };

  const agentRes = await fetch(
    `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(task.agent_mint)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  if (!agentRes.ok) return new Response('not found', { status: 404 });
  const agent = (await agentRes.json()) as { owner_privy_id: string };
  if (agent.owner_privy_id !== session.privyId) {
    return new Response('forbidden', { status: 403 });
  }

  const replayRes = await fetch(
    `${env.leashApiUrl}/v1/platform/tasks/${encodeURIComponent(id)}/activities`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  const replay = replayRes.ok
    ? (
        (await replayRes.json()) as {
          items: Array<{
            id: string;
            task_id: string;
            type: string;
            payload: Record<string, unknown>;
            cost_usdc: string | null;
            receipt_id: string | null;
            created_at: string;
          }>;
        }
      ).items
    : [];

  const channel = `leash:activity:${id}`;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: unknown) {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* connection closed */
        }
      }
      // Replay history first.
      for (const a of replay) send({ kind: 'activity', activity: a });
      send({ kind: 'replay_done' });

      const sub = createDedicatedSubscriber();
      if (!sub) {
        // No Redis — close after replay so the client falls back to polling.
        controller.close();
        return;
      }
      sub.subscribe(channel).catch(() => {
        controller.close();
      });
      sub.on('message', (_ch, message) => {
        try {
          send({ kind: 'activity', activity: JSON.parse(message) });
        } catch {
          /* skip malformed payload */
        }
      });
      const ping = setInterval(() => send({ kind: 'ping', ts: Date.now() }), 15_000);
      req.signal.addEventListener('abort', () => {
        clearInterval(ping);
        sub.disconnect();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

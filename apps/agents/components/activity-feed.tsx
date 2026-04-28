'use client';

import * as React from 'react';

export type ActivityRow = {
  id: string;
  task_id: string;
  type: 'think' | 'tool_call' | 'payment' | 'tool_result' | 'done' | 'error';
  payload: Record<string, unknown>;
  cost_usdc: string | null;
  receipt_id: string | null;
  created_at: string;
};

const COLORS: Record<ActivityRow['type'], string> = {
  think: 'text-fg-muted',
  tool_call: 'text-blue-300',
  payment: 'text-amber-300',
  tool_result: 'text-emerald-300',
  done: 'text-success',
  error: 'text-danger',
};

const LABELS: Record<ActivityRow['type'], string> = {
  think: 'Think',
  tool_call: 'Tool',
  payment: 'Pay',
  tool_result: 'Result',
  done: 'Done',
  error: 'Error',
};

export function ActivityFeed({ taskId }: { taskId: string }) {
  const [items, setItems] = React.useState<ActivityRow[]>([]);
  const [streaming, setStreaming] = React.useState<'idle' | 'sse' | 'polling'>('idle');
  const seen = React.useRef<Set<string>>(new Set());

  function append(a: ActivityRow) {
    if (seen.current.has(a.id)) return;
    seen.current.add(a.id);
    setItems((prev) => [...prev, a]);
  }

  React.useEffect(() => {
    let closed = false;
    const sse = new EventSource(`/api/tasks/${taskId}/stream`);
    setStreaming('sse');
    sse.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.kind === 'activity' && payload.activity) {
          append(payload.activity as ActivityRow);
        }
      } catch {
        /* ignore bad payload */
      }
    };
    sse.onerror = () => {
      if (closed) return;
      sse.close();
      setStreaming('polling');
      // Polling fallback for when Redis isn't configured.
      const id = setInterval(async () => {
        try {
          const r = await fetch(`/api/tasks/${taskId}/activities`, { credentials: 'include' });
          if (!r.ok) return;
          const body = (await r.json()) as { items: ActivityRow[] };
          for (const a of body.items) append(a);
        } catch {
          /* transient */
        }
      }, 1500);
      const cleanup = () => clearInterval(id);
      window.addEventListener('beforeunload', cleanup);
    };
    return () => {
      closed = true;
      sse.close();
    };
  }, [taskId]);

  return (
    <div className="rounded-lg border bg-bg-elev">
      <div className="px-4 py-2 text-xs text-fg-muted border-b flex items-center justify-between">
        <span>Activity</span>
        <span className="text-fg-subtle">{streaming}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-fg-muted">Waiting for the runtime…</div>
      ) : (
        <ol className="divide-y">
          {items.map((a) => (
            <li key={a.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
              <span className={`text-xs font-mono w-14 ${COLORS[a.type]}`}>{LABELS[a.type]}</span>
              <div className="flex-1 min-w-0">
                <ActivityBody type={a.type} payload={a.payload} cost={a.cost_usdc} />
              </div>
              <span className="text-xs text-fg-subtle whitespace-nowrap">
                {new Date(a.created_at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ActivityBody({
  type,
  payload,
  cost,
}: {
  type: ActivityRow['type'];
  payload: Record<string, unknown>;
  cost: string | null;
}) {
  switch (type) {
    case 'think':
      return <span>{String((payload as { text?: string }).text ?? '…')}</span>;
    case 'tool_call':
      return (
        <span>
          <code className="font-mono">{String((payload as { tool?: string }).tool)}</code>{' '}
          <span className="text-fg-muted">on</span>{' '}
          <code className="font-mono text-xs">
            {String((payload as { endpoint?: string }).endpoint)}
          </code>
        </span>
      );
    case 'payment':
      return (
        <span>
          {cost ?? String((payload as { amount?: string }).amount)} USDC{' '}
          <span className="text-fg-muted">
            via {String((payload as { scheme?: string }).scheme)} on{' '}
            {String((payload as { network?: string }).network)}
          </span>
        </span>
      );
    case 'tool_result':
      return (
        <span>
          <code className="font-mono">{String((payload as { tool?: string }).tool)}</code>:{' '}
          <span className="text-fg-muted">
            {String((payload as { sample?: string }).sample ?? 'ok')}
          </span>
        </span>
      );
    case 'done':
      return (
        <span className="text-success">
          {String((payload as { final_output?: string }).final_output ?? 'done')}
        </span>
      );
    case 'error':
      return (
        <span className="text-danger">
          {String((payload as { message?: string }).message ?? 'error')}
        </span>
      );
  }
}

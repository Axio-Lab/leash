import type { AgentEvent } from '@/lib/agents/types';

/**
 * Parse Server-Sent Events (`data: {...}\\n\\n`) from a fetch Response body.
 */
export async function* streamAgentEvents(res: Response): AsyncGenerator<AgentEvent> {
  const body = res.body;
  if (!body) throw new Error('No response body');
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const lines = raw.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
        try {
          yield JSON.parse(payload.trim()) as AgentEvent;
        } catch {
          /* malformed frame */
        }
      }
    }
  }
}

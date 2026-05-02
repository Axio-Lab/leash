import type { AgentEvent } from './types';

const enc = new TextEncoder();

export function sseEncode(event: AgentEvent): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(event)}\n\n`);
}

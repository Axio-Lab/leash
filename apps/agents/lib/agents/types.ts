export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | {
      type: 'artifact';
      artifact: {
        kind: 'payment_link' | 'payment_request' | 'receipt' | 'tool_call';
        payload: Record<string, unknown>;
      };
    }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'warning'; message: string };

/**
 * Helper LLM contracts.
 *
 * The conversational create page sends the user's chat history to the
 * server-side route `/api/helper`, which calls the user's LLM provider
 * with this set of tools. Tool execution happens server-side; the
 * client just renders messages and the running `AgentDraft`.
 *
 * Phase 1 keeps this simple: text-in, text-out + structured tool calls.
 * No streaming, no embeddings, no memory. Phase 3 polish swaps to
 * streaming once the rest of the demo is locked.
 */

export type AgentDraft = {
  name: string;
  description: string;
  model: 'claude-3-5-sonnet' | 'gpt-4o-mini' | 'gpt-4o';
  llmProvider: 'anthropic' | 'openai';
  systemPrompt: string;
  capabilities: Array<{
    slug: string | null;
    endpoint: string;
    tools: string[];
    paid?: boolean;
  }>;
  budget: { perAction: string; perTask: string; perDay: string };
};

export const DEFAULT_DRAFT: AgentDraft = {
  name: '',
  description: '',
  model: 'claude-3-5-sonnet',
  llmProvider: 'anthropic',
  systemPrompt: '',
  capabilities: [],
  budget: { perAction: '0.10', perTask: '1.00', perDay: '10.00' },
};

export const HELPER_SYSTEM_PROMPT = `You are the Leash agent setup helper.

Your job: turn the user's natural-language description into a complete \`AgentDraft\` that can be minted on Solana. Do this through short, polite turns. Ask one question at a time. When the draft is complete, call \`finalize\` so the UI shows a "Mint agent" button.

Rules:
- Default model: claude-3-5-sonnet (anthropic). Switch to gpt-4o or gpt-4o-mini only if the user asks.
- Default budget: 0.10 / 1.00 / 10.00 USDC (per action / per task / per day). Keep these unless the user wants tighter.
- ALWAYS call \`set_field\` whenever the user gives you a value (name, description, model, system prompt, budget).
- To add a tool, call \`search_marketplace\` first to find a real listing. Only call \`add_tool_by_url\` when the user pastes an explicit MCP URL.
- A reasonable default \`system_prompt\` references what the user said the agent should do; don't leave it empty.
- Call \`finalize\` exactly once when name, description, system_prompt, model, llm_provider are set and capabilities is non-empty.`;

export const HELPER_TOOLS = [
  {
    name: 'set_field',
    description:
      'Set a field on the agent draft. `path` is dot-notation, e.g. `name`, `system_prompt`, `budget.per_action`, `model`, `llm_provider`.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        value: {
          oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        },
      },
      required: ['path', 'value'],
    },
  },
  {
    name: 'search_marketplace',
    description:
      'Search leash.market for a tool listing. Returns up to 5 listings with name, slug, description, pricing summary, and rating.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_tool_by_url',
    description:
      "Attach a tool by its MCP `/.well-known/leash-mcp.json` URL. Validates the manifest and adds it to the draft's capabilities.",
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full HTTPS URL of the MCP manifest.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'finalize',
    description:
      "Signal that the draft is complete and ready to mint. Don't call until set_field has populated name, description, system_prompt, model, llm_provider; and at least one capability is attached.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
] as const;

export function applySetField(draft: AgentDraft, path: string, value: unknown): AgentDraft {
  const next = { ...draft, budget: { ...draft.budget } };
  switch (path) {
    case 'name':
      next.name = String(value);
      break;
    case 'description':
      next.description = String(value);
      break;
    case 'system_prompt':
      next.systemPrompt = String(value);
      break;
    case 'model': {
      const v = String(value);
      if (v === 'claude-3-5-sonnet' || v === 'gpt-4o' || v === 'gpt-4o-mini') {
        next.model = v;
        next.llmProvider = v.startsWith('claude') ? 'anthropic' : 'openai';
      }
      break;
    }
    case 'llm_provider': {
      const v = String(value);
      if (v === 'anthropic' || v === 'openai') next.llmProvider = v;
      break;
    }
    case 'budget.per_action':
      next.budget.perAction = String(value);
      break;
    case 'budget.per_task':
      next.budget.perTask = String(value);
      break;
    case 'budget.per_day':
      next.budget.perDay = String(value);
      break;
    default:
      break;
  }
  return next;
}

export function isDraftComplete(d: AgentDraft): boolean {
  return (
    d.name.trim().length > 0 &&
    d.description.trim().length > 0 &&
    d.systemPrompt.trim().length > 0 &&
    d.capabilities.length > 0
  );
}

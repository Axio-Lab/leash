/**
 * Minimal draft shape for onboarding (chat-first flow).
 */

export type AgentDraft = {
  name: string;
  description: string;
};

export const DEFAULT_DRAFT: AgentDraft = {
  name: '',
  description: '',
};

export function applySetField(draft: AgentDraft, path: string, value: unknown): AgentDraft {
  const next = { ...draft };
  switch (path) {
    case 'name':
      next.name = String(value);
      break;
    case 'description':
      next.description = String(value);
      break;
    default:
      break;
  }
  return next;
}

export function isDraftComplete(d: AgentDraft): boolean {
  return d.name.trim().length > 0 && d.description.trim().length > 0;
}

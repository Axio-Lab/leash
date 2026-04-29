'use client';

import { z } from 'zod';

const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemPromptFragment: z.string(),
  allowedToolSlugs: z.array(z.string()).optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

function key(privyId: string): string {
  return `leash:skills:${privyId}`;
}

export function loadSkills(privyId: string): Skill[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key(privyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const arr = z.array(SkillSchema).safeParse(parsed);
    return arr.success ? arr.data : [];
  } catch {
    return [];
  }
}

export function saveSkills(privyId: string, items: Skill[]): void {
  localStorage.setItem(key(privyId), JSON.stringify(items));
}

/** JSON array for `x-leash-skills` — consumed server-side by `/api/agents/chat`. */
export function skillsJsonForHeader(privyId: string): string | null {
  const items = loadSkills(privyId);
  if (items.length === 0) return null;
  const payload = items.map((s) => ({
    systemPromptFragment: s.systemPromptFragment,
    allowedToolSlugs: s.allowedToolSlugs ?? [],
  }));
  const json = JSON.stringify(payload);
  return json.length > 4096 ? null : json;
}

'use client';

import { z } from 'zod';

import { DEFAULT_SKILLS as DEFAULT_REGISTRY } from '@/lib/agents/default-skills';

const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemPromptFragment: z.string(),
  allowedToolSlugs: z.array(z.string()).optional(),
  source: z
    .object({
      kind: z.enum(['github', 'upload', 'paste']).optional(),
      url: z.string().optional(),
      repo: z.string().optional(),
    })
    .optional(),
  isDefault: z.boolean().optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

/**
 * Default bundle for the read-only Default tab. Same registry the
 * server uses to prepend onto every chat turn — see
 * `apps/agents/lib/agents/default-skills.ts`.
 */
export const DEFAULT_SKILLS: Skill[] = DEFAULT_REGISTRY.map((d) => ({
  id: d.id,
  name: d.name,
  systemPromptFragment: d.systemPromptFragment,
  isDefault: true,
  source: d.source ? { kind: 'github', url: d.source.url, repo: d.source.repo } : undefined,
}));

function key(privyId: string): string {
  return `leash:skills:${privyId}`;
}

/** User-authored skills only. */
export function loadCustomSkills(privyId: string): Skill[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key(privyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const arr = z.array(SkillSchema).safeParse(parsed);
    if (!arr.success) return [];
    return arr.data.filter((s) => !s.isDefault);
  } catch {
    return [];
  }
}

/** Combined view (defaults first). */
export function loadSkills(privyId: string): Skill[] {
  return [...DEFAULT_SKILLS, ...loadCustomSkills(privyId)];
}

export function saveCustomSkills(privyId: string, items: Skill[]): void {
  const customs = items.filter((s) => !s.isDefault);
  localStorage.setItem(key(privyId), JSON.stringify(customs));
}

/** Back-compat: persist customs only. */
export function saveSkills(privyId: string, items: Skill[]): void {
  saveCustomSkills(privyId, items);
}

/**
 * JSON for the `x-leash-skills` request header. Sends ONLY the user's
 * custom skills — defaults are merged in server-side so we don't blow
 * the 4 KiB header budget. Returns null if no customs / payload too big.
 */
export function skillsJsonForHeader(privyId: string): string | null {
  const customs = loadCustomSkills(privyId);
  if (customs.length === 0) return null;
  const payload = customs.map((s) => ({
    systemPromptFragment: s.systemPromptFragment,
    allowedToolSlugs: s.allowedToolSlugs ?? [],
  }));
  const json = JSON.stringify(payload);
  return json.length > 4096 ? null : json;
}

'use client';

import * as React from 'react';

import { loadSkills, saveSkills, type Skill } from '@/lib/skills';

import { usePrivy } from '@privy-io/react-auth';

export default function SkillsSettingsPage() {
  const { user } = usePrivy();
  const pid = user?.id ?? '';
  const [items, setItems] = React.useState<Skill[]>([]);
  const [name, setName] = React.useState('');
  const [fragment, setFragment] = React.useState('');

  React.useEffect(() => {
    if (!pid) return;
    setItems(loadSkills(pid));
  }, [pid]);

  function persist(next: Skill[]) {
    if (!pid) return;
    setItems(next);
    saveSkills(pid, next);
  }

  function add() {
    const n = name.trim();
    const f = fragment.trim();
    if (!n || !f) return;
    persist([
      ...items,
      {
        id: crypto.randomUUID?.() ?? `sk_${Date.now()}`,
        name: n,
        systemPromptFragment: f,
      },
    ]);
    setName('');
    setFragment('');
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-fg-muted">
        Skills append text to the model system prompt for every chat turn (via{' '}
        <code className="font-mono text-xs">x-leash-skills</code>).
      </p>
      <div className="space-y-3 max-w-lg">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Skill name"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
        />
        <textarea
          value={fragment}
          onChange={(e) => setFragment(e.target.value)}
          placeholder="System prompt fragment…"
          rows={4}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
        />
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
          onClick={add}
        >
          Add skill
        </button>
      </div>
      <ul className="space-y-3">
        {items.map((s) => (
          <li key={s.id} className="rounded-xl border border-border p-4">
            <div className="font-medium">{s.name}</div>
            <pre className="text-xs text-fg-muted mt-2 whitespace-pre-wrap">
              {s.systemPromptFragment}
            </pre>
            <button
              type="button"
              className="text-xs text-danger mt-2 hover:underline"
              onClick={() => persist(items.filter((x) => x.id !== s.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

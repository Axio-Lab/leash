'use client';

import * as React from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { toast } from 'sonner';
import { Trash2Icon } from 'lucide-react';

import { loadSkills, saveSkills, type Skill } from '@/lib/skills';
import { Button } from '@/components/ui/button';

export default function ProfileSkillsPage() {
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
    if (!n || !f) {
      toast.error('Skill needs both a name and a prompt fragment');
      return;
    }
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
    toast.success('Skill added');
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Add a skill</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            Skills append text to the system prompt for every chat turn (sent via{' '}
            <code className="font-mono text-[11px]">x-leash-skills</code>).
          </p>
        </div>
        <div className="space-y-2.5 max-w-xl">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name (e.g. 'Concise replies')"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
          />
          <textarea
            value={fragment}
            onChange={(e) => setFragment(e.target.value)}
            placeholder="System prompt fragment…"
            rows={4}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20 resize-y"
          />
          <Button type="button" onClick={add} disabled={!name.trim() || !fragment.trim()}>
            Add skill
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-fg-subtle px-1">
          Your skills ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/60 bg-bg/40 p-6 text-center text-sm text-fg-muted">
            No skills yet. Add one above to start customising your agent&apos;s tone or focus.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((s) => (
              <li key={s.id} className="rounded-xl border border-border bg-bg-elev/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-sm">{s.name}</div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-danger hover:underline"
                    onClick={() => {
                      persist(items.filter((x) => x.id !== s.id));
                      toast.success('Skill removed');
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                    Remove
                  </button>
                </div>
                <pre className="text-xs text-fg-muted mt-2.5 whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">
                  {s.systemPromptFragment}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

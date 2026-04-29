'use client';

import * as React from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { toast } from 'sonner';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  KeyboardIcon,
  LockIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';

import { DEFAULT_SKILLS, loadCustomSkills, saveCustomSkills, type Skill } from '@/lib/skills';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

const PER_PAGE = 5;

type AddMethod = 'paste' | 'upload' | 'install';

export default function ProfileSkillsPage() {
  const { user } = usePrivy();
  const pid = user?.id ?? '';

  const [customs, setCustoms] = React.useState<Skill[]>([]);
  const [tab, setTab] = React.useState<'default' | 'custom'>('default');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    if (!pid) return;
    setCustoms(loadCustomSkills(pid));
  }, [pid]);

  React.useEffect(() => {
    setPage(1);
  }, [tab]);

  function persist(next: Skill[]) {
    if (!pid) return;
    setCustoms(next);
    saveCustomSkills(pid, next);
  }

  function addCustom(skill: Skill) {
    persist([...customs, skill]);
    toast.success('Skill added', { description: skill.name });
    setTab('custom');
  }

  const list = tab === 'default' ? DEFAULT_SKILLS : customs;
  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * PER_PAGE;
  const visible = list.slice(start, start + PER_PAGE);

  return (
    <div className="space-y-6">
      <SkillCreator onAdd={addCustom} />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <TabButton
          active={tab === 'default'}
          onClick={() => setTab('default')}
          count={DEFAULT_SKILLS.length}
        >
          Default
        </TabButton>
        <TabButton
          active={tab === 'custom'}
          onClick={() => setTab('custom')}
          count={customs.length}
        >
          Custom
        </TabButton>
      </div>

      <p className="text-xs text-fg-muted -mt-3">
        {tab === 'default' ? (
          <>
            Pre-built skills bundled with every Leash agent. Each skill gives your agent the context
            it needs to operate as an economic actor.
          </>
        ) : (
          <>
            Skills you&apos;ve added. They append to the system prompt for every chat turn (sent via{' '}
            <code className="font-mono text-[11px]">x-leash-skills</code>).
          </>
        )}
      </p>

      {/* List */}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 bg-bg/40 p-8 text-center text-sm text-fg-muted">
          {tab === 'custom' ? (
            <>No custom skills yet. Add one above to start customising your agent.</>
          ) : (
            <>No default skills configured.</>
          )}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((s) => (
            <SkillRow
              key={s.id}
              skill={s}
              onRemove={() => {
                persist(customs.filter((x) => x.id !== s.id));
                toast.success('Skill removed');
              }}
            />
          ))}
        </ul>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-fg-muted">
            Page {clampedPage} of {totalPages} · {list.length} total
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={clampedPage <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm disabled:opacity-50 hover:border-border-strong"
            >
              <ChevronLeftIcon className="size-3.5" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={clampedPage >= totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm disabled:opacity-50 hover:border-border-strong"
            >
              Next
              <ChevronRightIcon className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
        active ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg'
      }`}
    >
      {children}
      <span
        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
          active ? 'bg-brand/15 text-brand-strong' : 'bg-bg-elev-2 text-fg-subtle'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function SkillRow({ skill, onRemove }: { skill: Skill; onRemove: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="rounded-xl border border-border bg-bg-elev/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{skill.name}</span>
            {skill.isDefault ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 text-brand-strong px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest">
                <LockIcon className="size-2.5" />
                Default
              </span>
            ) : null}
          </div>
          {skill.source?.repo ? (
            <a
              href={skill.source.url ?? `https://github.com/${skill.source.repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-[11px] text-fg-subtle hover:text-fg font-mono"
            >
              {skill.source.repo}
              <ExternalLinkIcon className="size-3" />
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-fg-muted hover:text-fg px-2 py-1 rounded hover:bg-bg-elev"
          >
            {open ? 'Hide' : 'View'}
          </button>
          {!skill.isDefault ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-danger hover:underline px-2 py-1"
              onClick={onRemove}
            >
              <Trash2Icon className="size-3.5" />
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <pre className="text-xs text-fg-muted mt-3 whitespace-pre-wrap font-mono wrap-anywhere bg-bg/40 rounded-lg p-3 border border-border/60 max-h-64 overflow-y-auto scrollbar-thin">
          {skill.systemPromptFragment}
        </pre>
      ) : null}
    </li>
  );
}

function SkillCreator({ onAdd }: { onAdd: (s: Skill) => void }) {
  const [method, setMethod] = React.useState<AddMethod>('paste');

  return (
    <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Add a skill</h2>
        <p className="text-xs text-fg-muted mt-0.5">
          Paste a prompt fragment, upload a SKILL.md file, or install one from a GitHub repo.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border border-border rounded-lg p-1 bg-bg/40 w-fit">
        <MethodTab
          active={method === 'paste'}
          onClick={() => setMethod('paste')}
          icon={KeyboardIcon}
        >
          Paste
        </MethodTab>
        <MethodTab
          active={method === 'upload'}
          onClick={() => setMethod('upload')}
          icon={UploadIcon}
        >
          Upload .md
        </MethodTab>
        <MethodTab
          active={method === 'install'}
          onClick={() => setMethod('install')}
          icon={GitBranchIcon}
        >
          Install URL
        </MethodTab>
      </div>

      {method === 'paste' ? <PasteForm onAdd={onAdd} /> : null}
      {method === 'upload' ? <UploadForm onAdd={onAdd} /> : null}
      {method === 'install' ? <InstallForm onAdd={onAdd} /> : null}
    </section>
  );
}

function MethodTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-bg-elev text-fg shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
          : 'text-fg-muted hover:text-fg hover:bg-bg-elev/60'
      }`}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function PasteForm({ onAdd }: { onAdd: (s: Skill) => void }) {
  const [name, setName] = React.useState('');
  const [fragment, setFragment] = React.useState('');

  function submit() {
    const n = name.trim();
    const f = fragment.trim();
    if (!n || !f) {
      toast.error('Skill needs both a name and a prompt fragment');
      return;
    }
    onAdd({
      id: crypto.randomUUID?.() ?? `sk_${Date.now()}`,
      name: n,
      systemPromptFragment: f,
      source: { kind: 'paste' },
    });
    setName('');
    setFragment('');
  }

  return (
    <div className="space-y-2.5">
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
        rows={5}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20 resize-y font-mono"
      />
      <Button type="button" onClick={submit} disabled={!name.trim() || !fragment.trim()}>
        Add skill
      </Button>
    </div>
  );
}

function UploadForm({ onAdd }: { onAdd: (s: Skill) => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!file) {
      toast.error('Pick a .md file first');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      if (text.trim().length === 0) {
        toast.error('File is empty');
        return;
      }
      const derived = name.trim() || file.name.replace(/\.(md|markdown)$/i, '');
      onAdd({
        id: crypto.randomUUID?.() ?? `sk_${Date.now()}`,
        name: derived,
        systemPromptFragment: text.slice(0, 32_000),
        source: { kind: 'upload' },
      });
      setFile(null);
      setName('');
    } catch (e) {
      toast.error('Could not read file', {
        description: e instanceof Error ? e.message : 'unknown',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name (optional — defaults to file name)"
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
      />
      <label
        htmlFor="skill-md-upload"
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-lg border border-dashed border-border bg-bg/40 px-4 py-3 cursor-pointer hover:border-brand/40"
      >
        <UploadIcon className="size-4 text-fg-subtle shrink-0" />
        <span className="text-sm text-fg-muted truncate flex-1">
          {file ? file.name : 'Choose a SKILL.md / README.md file'}
        </span>
        {file ? (
          <span className="text-[11px] text-fg-subtle shrink-0">
            {(file.size / 1024).toFixed(1)} KiB
          </span>
        ) : null}
        <input
          id="skill-md-upload"
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <Button type="button" onClick={() => void submit()} disabled={!file || busy}>
        {busy ? <Spinner size="sm" /> : null}
        Add skill
      </Button>
    </div>
  );
}

function InstallForm({ onAdd }: { onAdd: (s: Skill) => void }) {
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    const trimmed = input.trim();
    if (!trimmed) {
      toast.error('Paste an install command or GitHub URL');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/skills/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: trimmed }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        name?: string;
        systemPromptFragment?: string;
        sourceUrl?: string;
        repo?: string;
        message?: string;
      };
      if (!res.ok) {
        toast.error('Could not import skill', {
          description: j.message ?? `HTTP ${res.status}`,
        });
        return;
      }
      if (!j.name || !j.systemPromptFragment) {
        toast.error('Imported skill is missing fields');
        return;
      }
      onAdd({
        id: crypto.randomUUID?.() ?? `sk_${Date.now()}`,
        name: j.name,
        systemPromptFragment: j.systemPromptFragment,
        source: { kind: 'github', url: j.sourceUrl, repo: j.repo },
      });
      setInput('');
    } catch (e) {
      toast.error('Network error', {
        description: e instanceof Error ? e.message : 'unknown',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="npx skills add solana-foundation/solana-dev-skill"
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20 font-mono"
      />
      <p className="text-[11px] text-fg-subtle leading-snug">
        Accepts <code className="font-mono">owner/repo</code>, full{' '}
        <code className="font-mono">https://github.com/owner/repo</code> URL, or an{' '}
        <code className="font-mono">npx skills add …</code> command. We fetch{' '}
        <code className="font-mono">SKILL.md</code> (preferred) or{' '}
        <code className="font-mono">README.md</code> from the repo&apos;s default branch.
      </p>
      <Button type="button" onClick={() => void submit()} disabled={!input.trim() || busy}>
        {busy ? <Spinner size="sm" /> : null}
        Import skill
      </Button>
    </div>
  );
}

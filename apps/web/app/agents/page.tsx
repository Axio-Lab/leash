'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Bot, Trash2, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';

type SavedAgent = {
  mint: string;
  label?: string;
  capability?: 'buyer' | 'seller' | 'both';
  createdAt: string;
};

const STORAGE_KEY = 'leash:web:agents';

function loadAgents(): SavedAgent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedAgent[];
  } catch {
    return [];
  }
}

function saveAgents(agents: SavedAgent[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
}

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<SavedAgent[]>([]);
  const [mint, setMint] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [capability, setCapability] = React.useState<SavedAgent['capability']>('both');

  React.useEffect(() => {
    setAgents(loadAgents());
  }, []);

  function add() {
    const trimmed = mint.trim();
    if (!trimmed) return;
    const next = [
      {
        mint: trimmed,
        label: label.trim() || undefined,
        capability,
        createdAt: new Date().toISOString(),
      },
      ...agents.filter((a) => a.mint !== trimmed),
    ];
    setAgents(next);
    saveAgents(next);
    setMint('');
    setLabel('');
  }

  function remove(m: string) {
    const next = agents.filter((a) => a.mint !== m);
    setAgents(next);
    saveAgents(next);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/registry-utils"
        title="Agents"
        description="Track Core asset mints you're working with. Stored locally — no server state. Open one to see its profile and receipt feed."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4 text-brand" /> Track an agent
          </CardTitle>
          <CardDescription>Paste a Core asset mint to add it to your list.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mint">Asset mint</Label>
            <Input
              id="mint"
              value={mint}
              spellCheck={false}
              onChange={(e) => setMint(e.target.value)}
              className="font-mono"
              placeholder="11111111111111111111111111111111"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. weather-bot"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cap">Capability</Label>
            <select
              id="cap"
              value={capability}
              onChange={(e) => setCapability(e.target.value as SavedAgent['capability'])}
              className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm text-fg"
            >
              <option value="buyer">buyer</option>
              <option value="seller">seller</option>
              <option value="both">both</option>
            </select>
          </div>
          <Button onClick={add} disabled={!mint.trim()}>
            <Plus /> Add
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-brand" /> Tracked agents
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-fg-muted">
              No agents yet — add one above to get a profile + receipt feed.
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {agents.map((a) => (
                <li key={a.mint} className="flex items-center gap-3 py-3">
                  <Link
                    href={`/agents/${a.mint}`}
                    className="flex flex-1 items-center gap-3 min-w-0 hover:text-brand"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-bg-elev-2 text-fg-muted">
                      <Bot className="size-4" />
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{a.label ?? '—'}</span>
                      <code className="text-[11px] text-fg-subtle truncate font-mono">
                        {a.mint}
                      </code>
                    </div>
                  </Link>
                  <Badge variant="brand">{a.capability}</Badge>
                  <Link
                    href={`/agents/${a.mint}`}
                    className="text-fg-muted hover:text-fg inline-flex items-center gap-1 text-xs"
                  >
                    open <ExternalLink className="size-3" />
                  </Link>
                  <Button variant="ghost" size="icon" onClick={() => remove(a.mint)}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

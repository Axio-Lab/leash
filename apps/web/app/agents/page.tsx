'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Bot, Trash2, ExternalLink, Sparkles, Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import {
  listAgents,
  loadAgent,
  saveAgent,
  deleteAgent,
  type StoredAgent,
} from '@/lib/agent-storage';

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<
    Array<Pick<StoredAgent, 'mint' | 'label' | 'network' | 'createdAt'>>
  >([]);
  const [details, setDetails] = React.useState<Record<string, StoredAgent | null>>({});
  const [mint, setMint] = React.useState('');
  const [label, setLabel] = React.useState('');

  const refresh = React.useCallback(() => {
    const next = listAgents();
    setAgents(next);
    const map: Record<string, StoredAgent | null> = {};
    for (const a of next) map[a.mint] = loadAgent(a.mint);
    setDetails(map);
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  function add() {
    const trimmed = mint.trim();
    if (!trimmed) return;
    saveAgent({
      mint: trimmed,
      label: label.trim() || undefined,
      network: 'solana-devnet',
      rules: null,
    });
    setMint('');
    setLabel('');
    refresh();
  }

  function remove(m: string) {
    deleteAgent(m);
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/registry-utils"
        title="Agents"
        description="Each agent is a Metaplex Core asset (its identity). Operate it by registering your wallet as its Executive and delegating execution — every on-behalf-of-agent signature comes from your connected Privy wallet (no keys are stored in the browser)."
        actions={
          <Button asChild>
            <Link href="/agents/new">
              <Sparkles /> Create agent
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4 text-brand" /> Track an existing agent
          </CardTitle>
          <CardDescription>
            Already have a Core asset mint? Paste it to add it to your list — you can still inspect
            its profile, treasury, and receipts. To mint a brand-new agent and configure its
            behaviour rules, use{' '}
            <Link href="/agents/new" className="text-brand hover:underline">
              Create agent
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
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
              {agents.map((a) => {
                const detail = details[a.mint];
                const hasRules = !!detail?.rules;
                return (
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
                    <div className="hidden md:flex items-center gap-1">
                      {hasRules ? (
                        <Badge variant="brand" className="gap-1">
                          <Shield className="size-3" /> rules
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Shield className="size-3" /> limitless
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline">{a.network ?? 'solana-devnet'}</Badge>
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
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

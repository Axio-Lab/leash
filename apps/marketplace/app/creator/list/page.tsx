'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileJson,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

import { SnippetBlock } from '@/components/snippet-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';
import { EXAMPLE_DRAFT } from '@/lib/example-tool';
import {
  EMPTY_DRAFT,
  isDraftComplete,
  manifestToDraft,
  slugify,
  type ListingDraft,
  type ManifestImport,
} from '@/lib/listing-helper';
import { privyAuthedFetch } from '@/lib/privy-fetch';

type Stage = 'choose' | 'review' | 'submitted';
type ImportResp = { manifest: ManifestImport } | { error: string; message?: string };
type OwnedAgent = {
  mint: string;
  name: string;
  network: 'solana-devnet' | 'solana-mainnet';
  owner_wallet: string;
};

/**
 * Three-stage flow:
 *   1. Choose how to start — paste a manifest URL, build by hand, or
 *      copy the example. The chosen path produces a `ListingDraft`.
 *   2. Review every field (name, slug, pricing, tools…). Submit posts
 *      to `/api/listings` (BFF) which forwards to apps/api with the
 *      creator's Privy id + wallet attached.
 *   3. Done — show the seller-kit snippet so they can wrap their own
 *      endpoint with x402 in minutes.
 */
export default function CreatorListPage() {
  const router = useRouter();
  const { getAccessToken } = usePrivy();

  const [stage, setStage] = React.useState<Stage>('choose');
  const [draft, setDraft] = React.useState<ListingDraft>(EMPTY_DRAFT);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [agents, setAgents] = React.useState<OwnedAgent[]>([]);
  const [agentsBusy, setAgentsBusy] = React.useState(true);
  const [agentsError, setAgentsError] = React.useState<string | null>(null);
  const [selectedAgentMint, setSelectedAgentMint] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      setAgentsBusy(true);
      setAgentsError(null);
      try {
        const res = await privyAuthedFetch(getAccessToken, '/api/agents');
        const body = (await res.json().catch(() => null)) as {
          items?: OwnedAgent[];
          message?: string;
        } | null;
        if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
        const items = body?.items ?? [];
        if (cancelled) return;
        setAgents(items);
        setSelectedAgentMint((current) => current || items[0]?.mint || '');
      } catch (err) {
        if (!cancelled) setAgentsError((err as Error).message);
      } finally {
        if (!cancelled) setAgentsBusy(false);
      }
    }
    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  async function importFromUrl(url: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await privyAuthedFetch(getAccessToken, '/api/listings/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = (await res.json()) as ImportResp;
      if (!res.ok || !('manifest' in body)) {
        throw new Error('message' in body && body.message ? body.message : 'import failed');
      }
      setDraft(manifestToDraft(body.manifest));
      setStage('review');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(null);
    if (!selectedAgentMint) {
      setError('Select the agent identity that owns this capability before submitting.');
      return;
    }
    setBusy(true);
    try {
      const res = await privyAuthedFetch(getAccessToken, '/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: draft.slug,
          name: draft.name,
          description: draft.description,
          category: draft.category,
          seller_agent_mint: selectedAgentMint,
          endpoint: draft.endpoint,
          pricing: draft.pricing,
          tools: draft.tools,
          ...(draft.docsUrl ? { docs_url: draft.docsUrl } : {}),
          ...(draft.freeTier > 0 ? { free_tier: draft.freeTier } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setStage('submitted');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Badge
          variant="outline"
          className="border-brand/40 font-mono uppercase tracking-widest text-brand-strong"
        >
          <Sparkles className="size-3 mr-1.5" /> List capability
        </Badge>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Add an agent capability</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Anything an agent identity can call by HTTP — an MCP server, a paid REST API, or a
          callable tool — can be listed here. Free or paid. Approval is manual today; expect ~24h.
        </p>
      </header>

      <StageBar stage={stage} />

      {stage === 'choose' ? (
        <ChooseStage
          onUrl={importFromUrl}
          busy={busy}
          error={error}
          onManual={() => {
            setError(null);
            setDraft(EMPTY_DRAFT);
            setStage('review');
          }}
          onExample={() => {
            setError(null);
            setDraft(EXAMPLE_DRAFT);
            setStage('review');
          }}
        />
      ) : null}

      {stage === 'review' ? (
        <ReviewStage
          draft={draft}
          setDraft={setDraft}
          agents={agents}
          agentsBusy={agentsBusy}
          agentsError={agentsError}
          selectedAgentMint={selectedAgentMint}
          setSelectedAgentMint={setSelectedAgentMint}
          error={error}
          onBack={() => setStage('choose')}
          onSubmit={submit}
          busy={busy}
        />
      ) : null}

      {stage === 'submitted' ? <SubmittedStage draft={draft} router={router} /> : null}
    </div>
  );
}

function StageBar({ stage }: { stage: Stage }) {
  const steps: Array<{ id: Stage; label: string }> = [
    { id: 'choose', label: 'Source' },
    { id: 'review', label: 'Review' },
    { id: 'submitted', label: 'Wrap your endpoint' },
  ];
  const currentIdx = steps.findIndex((s) => s.id === stage);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <li
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1',
              i <= currentIdx ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-subtle',
            )}
          >
            <span
              className={cn(
                'grid size-4 place-items-center rounded-full text-[10px] font-medium',
                i < currentIdx
                  ? 'bg-brand text-white'
                  : i === currentIdx
                    ? 'bg-brand text-white'
                    : 'bg-bg-elev-2 text-fg-subtle',
              )}
            >
              {i < currentIdx ? <CheckCircle2 className="size-2.5" /> : i + 1}
            </span>
            {s.label}
          </li>
          {i < steps.length - 1 ? <span className="h-px w-4 bg-border" /> : null}
        </React.Fragment>
      ))}
    </ol>
  );
}

function ChooseStage({
  onUrl,
  busy,
  error,
  onManual,
  onExample,
}: {
  onUrl: (url: string) => void;
  busy: boolean;
  error: string | null;
  onManual: () => void;
  onExample: () => void;
}) {
  const [url, setUrl] = React.useState('');
  return (
    <Tabs defaultValue="url">
      <TabsList>
        <TabsTrigger value="url">From manifest URL</TabsTrigger>
        <TabsTrigger value="manual">Build by hand</TabsTrigger>
        <TabsTrigger value="example">Try an example</TabsTrigger>
      </TabsList>

      <TabsContent value="url">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileJson className="size-4 text-brand-strong" />
              <CardTitle>Paste your manifest URL</CardTitle>
            </div>
            <CardDescription>
              Host <code className="font-mono text-fg">/.well-known/leash-mcp.json</code> on the
              same origin as your endpoint. We'll fetch + validate it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                onUrl(url);
              }}
            >
              <Label htmlFor="manifest-url">Manifest URL</Label>
              <Input
                id="manifest-url"
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://search.example.com/.well-known/leash-mcp.json"
                className="font-mono"
              />
              {error ? <div className="text-danger text-xs">{error}</div> : null}
              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={busy || url.length === 0}>
                  {busy ? 'Importing…' : 'Import manifest'}
                  {!busy ? <ArrowRight className="size-4" /> : null}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="manual">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wand2 className="size-4 text-brand-strong" />
              <CardTitle>Build a listing by hand</CardTitle>
            </div>
            <CardDescription>
              Don't have a manifest yet? Fill in the fields directly. You can host the manifest
              later — agent identities only need the listing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={onManual} variant="default">
              Start blank <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="example">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-strong" />
              <CardTitle>Pre-fill with the &quot;Premium Web Search&quot; demo</CardTitle>
            </div>
            <CardDescription>
              Useful as a template. Tweak the slug/name/endpoint to make it yours, then submit. Or
              hit submit as-is to feel out the flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-x-auto rounded-md border bg-bg p-4 text-[11px] leading-relaxed font-mono text-fg-muted scrollbar-thin">
              {`{
  "name": "Premium Web Search",
  "slug": "premium-search",
  "endpoint": "https://search.demo.leash.market/mcp",
  "pricing": { "type": "per_call", "amount": "0.001", "currency": "USDC" },
  "tools": [{ "name": "search", "description": "..." }]
}`}
            </pre>
            <Button onClick={onExample}>
              Use the example <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function ReviewStage({
  draft,
  setDraft,
  agents,
  agentsBusy,
  agentsError,
  selectedAgentMint,
  setSelectedAgentMint,
  error,
  onBack,
  onSubmit,
  busy,
}: {
  draft: ListingDraft;
  setDraft: React.Dispatch<React.SetStateAction<ListingDraft>>;
  agents: OwnedAgent[];
  agentsBusy: boolean;
  agentsError: string | null;
  selectedAgentMint: string;
  setSelectedAgentMint: React.Dispatch<React.SetStateAction<string>>;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const selectedAgent = agents.find((agent) => agent.mint === selectedAgentMint) ?? null;
  const canSubmit = isDraftComplete(draft) && selectedAgent != null && !agentsBusy;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <SellerIdentitySelector
          agents={agents}
          busy={agentsBusy}
          error={agentsError}
          selectedAgentMint={selectedAgentMint}
          setSelectedAgentMint={setSelectedAgentMint}
        />

        <Card>
          <CardHeader>
            <CardTitle>Listing fields</CardTitle>
            <CardDescription>
              Review every field before submitting. Approval is manual today, but creators can fix
              anything later from <strong>My capabilities</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Name">
                <Input
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      name: e.target.value,
                      slug: d.slug.length === 0 ? slugify(e.target.value) : d.slug,
                    }))
                  }
                  placeholder="Premium Web Search"
                />
              </Field>
              <Field label="Slug">
                <Input
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
                  className="font-mono"
                  placeholder="premium-search"
                />
              </Field>
            </div>
            <Field label="One-line description">
              <Textarea
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2}
                placeholder="Short, clear, written for an agent — not a human."
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Category">
                <Input
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                  placeholder="search · data · payments · compute"
                />
              </Field>
              <Field label="Endpoint">
                <Input
                  value={draft.endpoint}
                  type="url"
                  onChange={(e) => setDraft((d) => ({ ...d, endpoint: e.target.value }))}
                  className="font-mono text-xs"
                  placeholder="https://your-tool.example/mcp"
                />
              </Field>
            </div>

            <div className="rounded-lg border bg-bg/40 p-4 space-y-3">
              <Label>Pricing</Label>
              <div className="flex flex-wrap gap-2">
                {(['free', 'per_call', 'variable'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, pricing: { ...d.pricing, type: t } }))}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs uppercase tracking-wide transition-colors',
                      draft.pricing.type === t
                        ? 'border-brand bg-brand/15 text-brand-strong'
                        : 'border-border text-fg-muted hover:border-border-strong',
                    )}
                  >
                    {t.replace('_', ' ')}
                  </button>
                ))}
              </div>
              {draft.pricing.type !== 'free' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount">
                    <Input
                      value={draft.pricing.amount ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          pricing: { ...d.pricing, amount: e.target.value },
                        }))
                      }
                      placeholder="0.001"
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Currency">
                    <Input
                      value={draft.pricing.currency ?? 'USDC'}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          pricing: { ...d.pricing, currency: e.target.value },
                        }))
                      }
                      placeholder="USDC"
                    />
                  </Field>
                </div>
              ) : null}
              <Field label="Free tier (calls / day, optional)">
                <Input
                  type="number"
                  min={0}
                  value={draft.freeTier}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, freeTier: Number(e.target.value || 0) }))
                  }
                  placeholder="0"
                />
              </Field>
            </div>

            <div>
              <Label>Tools</Label>
              <ul className="mt-2 divide-y divide-border rounded-md border bg-bg/40 text-xs">
                {draft.tools.length === 0 ? (
                  <li className="px-3 py-3 text-fg-subtle">
                    No callable tools detected. Add at least one operation by hand below or
                    re-import the manifest.
                  </li>
                ) : (
                  draft.tools.map((t, i) => (
                    <li
                      key={`${t.name}-${i}`}
                      className="grid grid-cols-[120px_1fr_auto] items-start gap-3 px-3 py-2"
                    >
                      <Input
                        value={t.name}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            tools: d.tools.map((tt, j) =>
                              j === i ? { ...tt, name: e.target.value } : tt,
                            ),
                          }))
                        }
                        className="font-mono text-[11px] h-7 px-2"
                      />
                      <Input
                        value={t.description}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            tools: d.tools.map((tt, j) =>
                              j === i ? { ...tt, description: e.target.value } : tt,
                            ),
                          }))
                        }
                        className="h-7 px-2"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            tools: d.tools.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))
                )}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    tools: [...d.tools, { name: '', description: '' }],
                  }))
                }
              >
                + Add callable tool
              </Button>
            </div>

            {error ? <div className="text-danger text-xs">{error}</div> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-20 self-start">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>How this listing will look to agent identities.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border bg-bg p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {draft.category || 'misc'}
              </Badge>
              <Badge variant={draft.pricing.type === 'free' ? 'free' : 'paid'}>
                {draft.pricing.type === 'free'
                  ? 'Free'
                  : `${draft.pricing.amount ?? '?'} ${draft.pricing.currency ?? 'USDC'}/call`}
              </Badge>
            </div>
            <div className="font-semibold">{draft.name || 'Untitled capability'}</div>
            <p className="text-xs text-fg-muted line-clamp-3">
              {draft.description || 'Add a one-line description.'}
            </p>
            <div className="text-[11px] text-fg-subtle">
              {draft.tools.length} callable tool{draft.tools.length === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
              {selectedAgent ? (
                <>
                  <ShieldCheck className="size-3 text-emerald-300" />
                  {selectedAgent.name} · {selectedAgent.network.replace('solana-', '')}
                </>
              ) : (
                <>
                  <AlertTriangle className="size-3 text-amber-300" />
                  Select seller identity
                </>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={onSubmit} disabled={busy || !canSubmit}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" /> Back to source
            </Button>
            {!isDraftComplete(draft) ? (
              <p className="text-[11px] text-fg-subtle">
                Add a name, slug (≥2 chars), description, endpoint, and at least one callable tool
                to enable submit.
              </p>
            ) : null}
            {isDraftComplete(draft) && !selectedAgent ? (
              <p className="text-[11px] text-fg-subtle">
                Pick an owned agent identity so this capability can carry seller proof.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SellerIdentitySelector({
  agents,
  busy,
  error,
  selectedAgentMint,
  setSelectedAgentMint,
}: {
  agents: OwnedAgent[];
  busy: boolean;
  error: string | null;
  selectedAgentMint: string;
  setSelectedAgentMint: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-brand-strong" />
          <CardTitle>Seller identity</CardTitle>
        </div>
        <CardDescription>
          New native listings are anchored to an agent identity. Buyers and agents use this link for
          trust checks, reputation, and proof trails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="seller-agent">Agent identity</Label>
        <select
          id="seller-agent"
          value={selectedAgentMint}
          onChange={(event) => setSelectedAgentMint(event.target.value)}
          disabled={busy || agents.length === 0}
          className="min-h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:opacity-50"
        >
          {busy ? <option value="">Loading identities…</option> : null}
          {!busy && agents.length === 0 ? (
            <option value="">No agent identities found</option>
          ) : null}
          {agents.map((agent) => (
            <option key={agent.mint} value={agent.mint}>
              {agent.name} · {agent.network.replace('solana-', '')} · {shortMint(agent.mint)}
            </option>
          ))}
        </select>
        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : agents.length === 0 && !busy ? (
          <p className="text-xs text-fg-muted">
            Create an agent identity first, then return here to list the capability.{' '}
            <a className="text-brand hover:underline" href={`${NEXT_PUBLIC_AGENTS_URL}/profile`}>
              Open agents
            </a>
          </p>
        ) : (
          <p className="text-xs text-fg-muted">
            This identity will be shown on marketplace cards and used for verification decisions.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function SubmittedStage({
  draft,
  router,
}: {
  draft: ListingDraft;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div className="space-y-6">
      <Card className="bg-aurora">
        <CardHeader className="space-y-2 text-center">
          <CheckCircle2 className="mx-auto size-7 text-emerald-300" />
          <CardTitle className="text-2xl">Submitted for approval</CardTitle>
          <CardDescription className="max-w-xl mx-auto">
            <strong>{draft.name}</strong> is in our moderation queue. Approval typically takes under
            24h. While you wait, drop the seller-kit snippet into your endpoint so it's x402-ready
            by go-live.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-brand/40 font-mono uppercase text-brand-strong"
            >
              Step 3 · Seller kit
            </Badge>
          </div>
          <CardTitle className="mt-2">Drop in this snippet to accept x402 payments</CardTitle>
          <CardDescription>
            Pick the runtime that matches your stack. The middleware short-circuits unauthenticated
            calls with a 402 + payment instructions and only forwards to your handler once payment
            is verified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SnippetBlock
            params={{
              slug: draft.slug,
              toolName: draft.tools[0]?.name ?? 'search',
              amount: draft.pricing.amount ?? '0.001',
              currency: draft.pricing.currency ?? 'USDC',
            }}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => router.push('/creator/tools')}>
          Go to my capabilities <ArrowRight className="size-4" />
        </Button>
        <Button variant="outline" onClick={() => router.push('/creator/docs')}>
          Read the full guide
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { applySetField, DEFAULT_DRAFT, isDraftComplete, type AgentDraft } from '@/lib/agent-helper';
import { mintAgentBrowserSide } from '@/lib/mint-agent';
import { usePrivyUmi } from '@/lib/use-privy-umi';
import { SOLANA_NETWORK } from '@/lib/env';

type Step = 'basics' | 'tools' | 'llm' | 'budget' | 'review' | 'minting' | 'done';

export function AgentCreateChat({ initialAddSlug }: { initialAddSlug: string | null }) {
  const router = useRouter();
  const { umi, wallet, ready } = usePrivyUmi();
  const [draft, setDraft] = React.useState<AgentDraft>(DEFAULT_DRAFT);
  const [step, setStep] = React.useState<Step>('basics');
  const [error, setError] = React.useState<string | null>(null);
  const [llmKey, setLlmKey] = React.useState('');
  const [mintProgress, setMintProgress] = React.useState<string | null>(null);

  function setField(path: string, value: unknown) {
    setDraft((d) => applySetField(d, path, value));
  }

  React.useEffect(() => {
    if (initialAddSlug) {
      // Marketplace -> agents handshake. Persisted resolve happens in
      // <ToolStep> via /api/marketplace-search?slug=…
    }
  }, [initialAddSlug]);

  return (
    <div className="space-y-6">
      <Stepper current={step} />
      <div className="rounded-lg border bg-bg-elev p-5">
        {step === 'basics' ? (
          <BasicsStep draft={draft} setField={setField} onNext={() => setStep('tools')} />
        ) : step === 'tools' ? (
          <ToolsStep
            draft={draft}
            setDraft={setDraft}
            initialAddSlug={initialAddSlug}
            onBack={() => setStep('basics')}
            onNext={() => setStep('llm')}
          />
        ) : step === 'llm' ? (
          <LlmStep
            draft={draft}
            setField={setField}
            llmKey={llmKey}
            setLlmKey={setLlmKey}
            onBack={() => setStep('tools')}
            onNext={() => setStep('budget')}
          />
        ) : step === 'budget' ? (
          <BudgetStep
            draft={draft}
            setField={setField}
            onBack={() => setStep('llm')}
            onNext={() => setStep('review')}
          />
        ) : step === 'review' ? (
          <ReviewStep
            draft={draft}
            ready={ready}
            wallet={wallet?.address ?? ''}
            onBack={() => setStep('budget')}
            onMint={async () => {
              if (!umi || !wallet) {
                setError('connect a Solana wallet to mint');
                return;
              }
              if (!isDraftComplete(draft)) {
                setError('draft is incomplete');
                return;
              }
              if (llmKey.trim().length < 8) {
                setError('add your LLM provider key (it stays encrypted at rest)');
                return;
              }
              setStep('minting');
              setError(null);
              try {
                setMintProgress('Minting agent on Solana…');
                const minted = await mintAgentBrowserSide({
                  umi,
                  wallet: wallet.address,
                  name: draft.name,
                  description: draft.description,
                });
                setMintProgress('Recording agent and provisioning service key…');
                const res = await fetch('/api/agents', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    mint: minted.mint,
                    treasury: minted.treasury,
                    name: draft.name,
                    description: draft.description,
                    network: SOLANA_NETWORK,
                    model: draft.model,
                    system_prompt: draft.systemPrompt,
                    capabilities: draft.capabilities.map((c) => ({
                      slug: c.slug,
                      endpoint: c.endpoint,
                      tools: c.tools,
                      ...(c.paid !== undefined ? { paid: c.paid } : {}),
                    })),
                    budget: {
                      per_action: draft.budget.perAction,
                      per_task: draft.budget.perTask,
                      per_day: draft.budget.perDay,
                    },
                    llm_provider: draft.llmProvider,
                    llm_api_key: llmKey,
                  }),
                });
                if (!res.ok) {
                  const txt = await res.text();
                  throw new Error(txt);
                }
                setStep('done');
                setTimeout(() => router.push(`/agents/${minted.mint}/fund`), 600);
              } catch (err) {
                setError((err as Error).message);
                setStep('review');
              }
            }}
          />
        ) : step === 'minting' ? (
          <div className="py-10 text-center text-sm text-fg-muted">
            {mintProgress ?? 'Working…'}
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-success">
            Agent minted. Redirecting to funding…
          </div>
        )}
        {error ? <div className="mt-4 text-danger text-sm">{error}</div> : null}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: 'basics', label: 'Basics' },
    { id: 'tools', label: 'Tools' },
    { id: 'llm', label: 'LLM' },
    { id: 'budget', label: 'Budget' },
    { id: 'review', label: 'Review' },
  ];
  const currentIndex = steps.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <span
            className={
              i === currentIndex
                ? 'text-fg font-medium'
                : i < currentIndex
                  ? 'text-fg-muted'
                  : 'text-fg-subtle'
            }
          >
            {s.label}
          </span>
          {i < steps.length - 1 ? <span className="text-fg-subtle">›</span> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">{label}</span>
        {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
      </div>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function BasicsStep({
  draft,
  setField,
  onNext,
}: {
  draft: AgentDraft;
  setField: (p: string, v: unknown) => void;
  onNext: () => void;
}) {
  const ok = draft.name.trim().length > 0 && draft.description.trim().length > 0;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Tell me about your agent.</h2>
        <p className="text-sm text-fg-muted">
          Name + a short description. We'll seed a system prompt from it.
        </p>
      </div>
      <Field label="Name">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder="e.g. Solana Researcher"
          maxLength={120}
          className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Description" hint="One sentence is enough.">
        <textarea
          value={draft.description}
          onChange={(e) => {
            setField('description', e.target.value);
            if (draft.systemPrompt.length === 0) {
              setField(
                'system_prompt',
                `You are a helpful agent. Goal: ${e.target.value}. Use the available tools when they help.`,
              );
            }
          }}
          rows={3}
          className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
        />
      </Field>
      <Field label="System prompt" hint="Edit if you want.">
        <textarea
          value={draft.systemPrompt}
          onChange={(e) => setField('system_prompt', e.target.value)}
          rows={3}
          className="w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono"
        />
      </Field>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!ok}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

type Listing = {
  slug: string;
  name: string;
  description: string;
  endpoint: string;
  tools: Array<{ name: string }>;
  pricing?: { type: string; amount?: string; currency?: string };
};

function ToolsStep({
  draft,
  setDraft,
  initialAddSlug,
  onBack,
  onNext,
}: {
  draft: AgentDraft;
  setDraft: React.Dispatch<React.SetStateAction<AgentDraft>>;
  initialAddSlug: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Listing[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (initialAddSlug) {
      setQuery(initialAddSlug);
      void search(initialAddSlug);
    }
  }, [initialAddSlug]);

  async function search(q: string) {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/marketplace-search?q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items: Listing[] };
      setResults(body.items ?? []);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function addByUrl() {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/manifest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url }),
      });
      const body = (await res.json()) as
        | {
            manifest: {
              name: string;
              slug: string | null;
              endpoint: string;
              tools: Array<{ name: string }>;
              pricing: { type: string };
            };
          }
        | { error: string; message: string };
      if (!res.ok || !('manifest' in body)) {
        throw new Error('message' in body ? body.message : 'failed to validate manifest');
      }
      setDraft((d) => ({
        ...d,
        capabilities: [
          ...d.capabilities,
          {
            slug: body.manifest.slug,
            endpoint: body.manifest.endpoint,
            tools: body.manifest.tools.map((t) => t.name),
            paid: body.manifest.pricing.type !== 'free',
          },
        ],
      }));
      setUrl('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  function attach(listing: Listing) {
    setDraft((d) => ({
      ...d,
      capabilities: [
        ...d.capabilities,
        {
          slug: listing.slug,
          endpoint: listing.endpoint,
          tools: listing.tools.map((t) => t.name),
          paid: (listing.pricing?.type ?? 'free') !== 'free',
        },
      ],
    }));
  }

  function remove(idx: number) {
    setDraft((d) => ({ ...d, capabilities: d.capabilities.filter((_, i) => i !== idx) }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Add tools.</h2>
        <p className="text-sm text-fg-muted">
          Search the marketplace, or paste a direct MCP manifest URL.
        </p>
      </div>
      <div className="space-y-2">
        <Field label="Search marketplace">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. web search, airtime"
              className="flex-1 rounded-md border bg-bg px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => search(query)}
              disabled={searching || query.length === 0}
              className="rounded-md border px-3 py-2 text-sm hover:border-border-strong disabled:opacity-60"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
        </Field>
        {results !== null ? (
          results.length === 0 ? (
            <div className="text-xs text-fg-muted">
              No marketplace listings yet. Use "Add by URL" below.
            </div>
          ) : (
            <ul className="space-y-2">
              {results.map((l) => (
                <li key={l.slug} className="rounded-md border bg-bg p-3 flex items-start gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{l.name}</div>
                    <div className="text-xs text-fg-muted mt-1">{l.description}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => attach(l)}
                    className="text-xs rounded-md bg-brand px-2 py-1 text-white hover:bg-brand-strong"
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
        <Field label="Add by URL" hint="A `/.well-known/leash-mcp.json`">
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://airtime.example/.well-known/leash-mcp.json"
              className="flex-1 rounded-md border bg-bg px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={addByUrl}
              disabled={adding || url.length === 0}
              className="rounded-md border px-3 py-2 text-sm hover:border-border-strong disabled:opacity-60"
            >
              {adding ? 'Validating…' : 'Add'}
            </button>
          </div>
        </Field>
      </div>
      {draft.capabilities.length > 0 ? (
        <div>
          <div className="text-xs text-fg-muted mb-2">Attached tools</div>
          <ul className="space-y-1">
            {draft.capabilities.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-md border bg-bg px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{c.slug ?? c.endpoint}</span>
                  <span className="ml-2 text-xs text-fg-muted">{c.tools.join(', ')}</span>
                  {c.paid ? (
                    <span className="ml-2 text-xs text-warning">paid</span>
                  ) : (
                    <span className="ml-2 text-xs text-fg-subtle">free</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-xs text-danger hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <div className="text-danger text-xs">{error}</div> : null}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border px-4 py-2 text-sm hover:border-border-strong"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={draft.capabilities.length === 0}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function LlmStep({
  draft,
  setField,
  llmKey,
  setLlmKey,
  onBack,
  onNext,
}: {
  draft: AgentDraft;
  setField: (p: string, v: unknown) => void;
  llmKey: string;
  setLlmKey: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">LLM provider.</h2>
        <p className="text-sm text-fg-muted">
          Pick a model and paste your provider key. We encrypt and store it server-side; the agent
          runtime decrypts only inside its own process.
        </p>
      </div>
      <Field label="Model">
        <select
          value={draft.model}
          onChange={(e) => setField('model', e.target.value)}
          className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
        >
          <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Anthropic)</option>
          <option value="gpt-4o">GPT-4o (OpenAI)</option>
          <option value="gpt-4o-mini">GPT-4o-mini (OpenAI)</option>
        </select>
      </Field>
      <Field label={`${draft.llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`}>
        <input
          type="password"
          value={llmKey}
          onChange={(e) => setLlmKey(e.target.value)}
          placeholder={draft.llmProvider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
          className="w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono"
        />
      </Field>
      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="rounded-md border px-4 py-2 text-sm">
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={llmKey.trim().length < 8}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function BudgetStep({
  draft,
  setField,
  onBack,
  onNext,
}: {
  draft: AgentDraft;
  setField: (p: string, v: unknown) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Budget.</h2>
        <p className="text-sm text-fg-muted">
          Hard caps in USDC. The runtime stops the moment any limit would be exceeded.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Per action">
          <input
            type="text"
            value={draft.budget.perAction}
            onChange={(e) => setField('budget.per_action', e.target.value)}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Per task">
          <input
            type="text"
            value={draft.budget.perTask}
            onChange={(e) => setField('budget.per_task', e.target.value)}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Per day">
          <input
            type="text"
            value={draft.budget.perDay}
            onChange={(e) => setField('budget.per_day', e.target.value)}
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm font-mono"
          />
        </Field>
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="rounded-md border px-4 py-2 text-sm">
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function ReviewStep({
  draft,
  ready,
  wallet,
  onBack,
  onMint,
}: {
  draft: AgentDraft;
  ready: boolean;
  wallet: string;
  onBack: () => void;
  onMint: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Ready to mint.</h2>
        <p className="text-sm text-fg-muted">
          Sign the mint transaction with your wallet. You'll fund the treasury next.
        </p>
      </div>
      <dl className="text-sm grid grid-cols-[140px_1fr] gap-y-1.5">
        <dt className="text-fg-muted">Name</dt>
        <dd>{draft.name}</dd>
        <dt className="text-fg-muted">Description</dt>
        <dd>{draft.description}</dd>
        <dt className="text-fg-muted">Model</dt>
        <dd>{draft.model}</dd>
        <dt className="text-fg-muted">Capabilities</dt>
        <dd>
          {draft.capabilities.length === 0 ? (
            <span className="text-fg-muted">none</span>
          ) : (
            draft.capabilities.map((c, i) => (
              <span key={i} className="block">
                {c.slug ?? c.endpoint} <span className="text-fg-muted">({c.tools.join(', ')})</span>
              </span>
            ))
          )}
        </dd>
        <dt className="text-fg-muted">Budget</dt>
        <dd>
          {draft.budget.perAction} / {draft.budget.perTask} / {draft.budget.perDay} USDC
        </dd>
        <dt className="text-fg-muted">Owner wallet</dt>
        <dd className="font-mono truncate">{wallet || '—'}</dd>
      </dl>
      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="rounded-md border px-4 py-2 text-sm">
          Back
        </button>
        <button
          type="button"
          onClick={onMint}
          disabled={!ready || !wallet}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {ready && wallet ? 'Mint agent' : 'Connect wallet first'}
        </button>
      </div>
    </div>
  );
}

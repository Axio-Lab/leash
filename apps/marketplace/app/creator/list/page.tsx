'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileJson,
  Link2,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

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
  type ListingEndpoint,
  type ListingPricing,
  type ManifestImport,
} from '@/lib/listing-helper';
import { privyAuthedFetch } from '@/lib/privy-fetch';
import {
  PAYMENT_RAILS,
  STABLE_CURRENCIES,
  type PaymentRail,
  type StableCurrency,
} from '@/lib/seller-kit';

type Stage = 'choose' | 'review' | 'submitted';
type ImportResp = { manifest: ManifestImport } | { error: string; message?: string };
type OwnedAgent = {
  mint: string;
  name: string;
  network: 'solana-devnet' | 'solana-mainnet';
  owner_wallet: string;
};

const SELECT_CLASS =
  'min-h-10 w-full min-w-0 max-w-full truncate rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:opacity-50';

/**
 * Discovery-only creator flow:
 *   1. Choose a manifest, blank draft, example, or prefilled monetized endpoint.
 *   2. Review provider metadata and one or more payable endpoints.
 *   3. Publish the listing directly to marketplace discovery.
 */
export default function CreatorListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getAccessToken } = usePrivy();

  const [stage, setStage] = React.useState<Stage>('choose');
  const [draft, setDraft] = React.useState<ListingDraft>(EMPTY_DRAFT);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [agents, setAgents] = React.useState<OwnedAgent[]>([]);
  const [agentsBusy, setAgentsBusy] = React.useState(true);
  const [agentsError, setAgentsError] = React.useState<string | null>(null);
  const [selectedAgentMint, setSelectedAgentMint] = React.useState('');
  const appliedPrefill = React.useRef(false);

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

  React.useEffect(() => {
    if (appliedPrefill.current) return;
    const endpointUrl = searchParams.get('endpoint_url');
    if (!endpointUrl) return;
    appliedPrefill.current = true;
    const endpointDescription = searchParams.get('endpoint_description') ?? 'Payable endpoint';
    const providerUrl = searchParams.get('provider_url') ?? originFromUrl(endpointUrl);
    const pricing = pricingFromParams(searchParams);
    setDraft({
      slug: slugify(endpointDescription) || 'payable-endpoint',
      name: titleFromDescription(endpointDescription),
      description: endpointDescription,
      category: 'misc',
      endpoint: providerUrl || endpointUrl,
      pricing,
      endpoints: [
        {
          method: searchParams.get('endpoint_method') === 'GET' ? 'GET' : 'POST',
          url: endpointUrl,
          description: endpointDescription,
          pricing,
          protocol: [searchParams.get('endpoint_protocol') ?? 'x402'],
          supported_usd: supportedFromParams(searchParams),
        },
      ],
      freeTier: 0,
    });
    setStage('review');
  }, [searchParams]);

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

  async function publishListing() {
    setError(null);
    if (!selectedAgentMint) {
      setError('Select the agent identity that owns this capability before publishing.');
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
          endpoints: draft.endpoints,
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
          <Sparkles className="mr-1.5 size-3" aria-hidden="true" /> List capability
        </Badge>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Add a capability to discovery
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Publish a provider URL and the payable endpoints agents can call. To make a raw endpoint
          payable first, use the monetize endpoint flow.
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
          onPublish={publishListing}
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
    { id: 'review', label: 'Discovery details' },
    { id: 'submitted', label: 'Published' },
  ];
  const currentIdx = steps.findIndex((s) => s.id === stage);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <li
            className={cn(
              'flex min-h-8 items-center gap-2 rounded-full border px-3 py-1',
              i <= currentIdx ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-subtle',
            )}
          >
            <span
              className={cn(
                'grid size-4 place-items-center rounded-full text-[10px] font-medium',
                i <= currentIdx ? 'bg-brand text-white' : 'bg-bg-elev-2 text-fg-subtle',
              )}
            >
              {i < currentIdx ? <CheckCircle2 className="size-2.5" aria-hidden="true" /> : i + 1}
            </span>
            {s.label}
          </li>
          {i < steps.length - 1 ? <span className="hidden h-px w-4 bg-border sm:block" /> : null}
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
              <FileJson className="size-4 text-brand-strong" aria-hidden="true" />
              <CardTitle>Paste your manifest URL</CardTitle>
            </div>
            <CardDescription>
              Import provider metadata and payable endpoints from{' '}
              <code className="font-mono text-fg">/.well-known/leash-mcp.json</code>.
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
              <Field id="manifest-url" label="Manifest URL">
                <Input
                  id="manifest-url"
                  type="url"
                  inputMode="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://search.example.com/.well-known/leash-mcp.json"
                  className="font-mono"
                />
              </Field>
              {error ? <InlineError message={error} /> : null}
              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={busy || url.length === 0}>
                  {busy ? 'Importing...' : 'Import manifest'}
                  {!busy ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
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
              <Wand2 className="size-4 text-brand-strong" aria-hidden="true" />
              <CardTitle>Build a listing by hand</CardTitle>
            </div>
            <CardDescription>
              Use this when your payable endpoint already exists and you want it in discovery.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={onManual} variant="default">
              Start blank <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="example">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-strong" aria-hidden="true" />
              <CardTitle>Pre-fill with the Premium Web Search demo</CardTitle>
            </div>
            <CardDescription>
              Shows the provider URL plus two payable endpoints with different methods and prices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-x-auto rounded-md border bg-bg p-4 font-mono text-[11px] leading-relaxed text-fg-muted scrollbar-thin">
              {`{
  "name": "Premium Web Search",
  "endpoint": "https://search.demo.leash.market",
  "endpoints": [
    { "method": "POST", "url": "https://api.leash.market/x/premium-search" }
  ]
}`}
            </pre>
            <Button onClick={onExample}>
              Use the example <ArrowRight className="size-4" aria-hidden="true" />
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
  onPublish,
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
  onPublish: () => void;
  busy: boolean;
}) {
  const selectedAgent = agents.find((agent) => agent.mint === selectedAgentMint) ?? null;
  const canPublish = isDraftComplete(draft) && selectedAgent != null && !agentsBusy;

  const updateEndpoint = React.useCallback(
    (index: number, patch: Partial<ListingEndpoint>) => {
      setDraft((d) => ({
        ...d,
        endpoints: d.endpoints.map((endpoint, j) =>
          j === index ? { ...endpoint, ...patch } : endpoint,
        ),
      }));
    },
    [setDraft],
  );

  const updateEndpointPricing = React.useCallback(
    (index: number, patch: Partial<ListingPricing>) => {
      setDraft((d) => ({
        ...d,
        endpoints: d.endpoints.map((endpoint, j) =>
          j === index
            ? { ...endpoint, pricing: { ...(endpoint.pricing ?? d.pricing), ...patch } }
            : endpoint,
        ),
      }));
    },
    [setDraft],
  );

  const toggleEndpointCurrency = React.useCallback(
    (index: number, currency: StableCurrency) => {
      setDraft((d) => ({
        ...d,
        endpoints: d.endpoints.map((endpoint, j) => {
          if (j !== index) return endpoint;
          const current = endpoint.supported_usd ?? [];
          return {
            ...endpoint,
            supported_usd: current.includes(currency)
              ? current.filter((c) => c !== currency)
              : [...current, currency],
          };
        }),
      }));
    },
    [setDraft],
  );

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
            <CardTitle>Provider details</CardTitle>
            <CardDescription>
              These fields describe the service provider. Paywall creation happens on the Monetize
              endpoint page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="listing-name" label="Name">
                <Input
                  id="listing-name"
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
              <Field id="listing-slug" label="Slug">
                <Input
                  id="listing-slug"
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
                  className="font-mono"
                  placeholder="premium-search"
                />
              </Field>
            </div>
            <Field id="listing-description" label="One-line description">
              <Textarea
                id="listing-description"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2}
                placeholder="Short, clear, written for an agent - not a human."
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="listing-category" label="Category">
                <Input
                  id="listing-category"
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                  placeholder="search, data, payments, compute"
                />
              </Field>
              <Field id="provider-url" label="Provider URL">
                <Input
                  id="provider-url"
                  value={draft.endpoint}
                  type="url"
                  inputMode="url"
                  onChange={(e) => setDraft((d) => ({ ...d, endpoint: e.target.value }))}
                  className="font-mono text-xs"
                  placeholder="https://provider.example.com"
                />
              </Field>
            </div>

            <div className="rounded-lg border bg-bg/40 p-4 space-y-3">
              <Label>Discovery price summary</Label>
              <p className="text-xs text-fg-muted">
                Used for browse filters and cards. Individual endpoint rows below carry the exact
                payable price and rail.
              </p>
              <div className="flex flex-wrap gap-2">
                {(['free', 'per_call', 'variable'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, pricing: { ...d.pricing, type } }))}
                    className={cn(
                      'min-h-10 rounded-md border px-3 py-2 text-xs uppercase tracking-wide transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
                      draft.pricing.type === type
                        ? 'border-brand bg-brand/15 text-brand-strong'
                        : 'border-border text-fg-muted hover:border-border-strong',
                    )}
                  >
                    {type.replace('_', ' ')}
                  </button>
                ))}
              </div>
              {draft.pricing.type !== 'free' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="listing-amount" label="Amount">
                    <Input
                      id="listing-amount"
                      value={draft.pricing.amount ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          pricing: { ...d.pricing, amount: e.target.value },
                        }))
                      }
                      inputMode="decimal"
                      placeholder="0.001"
                      className="font-mono"
                    />
                  </Field>
                  <Field id="listing-currency" label="Currency">
                    <select
                      id="listing-currency"
                      value={(draft.pricing.currency as StableCurrency | undefined) ?? 'USDC'}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          pricing: { ...d.pricing, currency: e.target.value },
                        }))
                      }
                      className={cn(SELECT_CLASS, 'font-mono')}
                    >
                      {STABLE_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}
              <Field id="free-tier" label="Free tier calls / day">
                <Input
                  id="free-tier"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draft.freeTier}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, freeTier: Number(e.target.value || 0) }))
                  }
                  placeholder="0"
                />
              </Field>
            </div>

            <PayableEndpointEditor
              draft={draft}
              setDraft={setDraft}
              updateEndpoint={updateEndpoint}
              updateEndpointPricing={updateEndpointPricing}
              toggleEndpointCurrency={toggleEndpointCurrency}
            />

            {error ? <InlineError message={error} /> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="self-start lg:sticky lg:top-20">
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
                {formatPricing(draft.pricing)}
              </Badge>
            </div>
            <div className="font-semibold">{draft.name || 'Untitled capability'}</div>
            <p className="line-clamp-3 text-xs text-fg-muted">
              {draft.description || 'Add a one-line description.'}
            </p>
            <div className="text-[11px] text-fg-subtle">
              {draft.endpoints.length} payable endpoint{draft.endpoints.length === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
              {selectedAgent ? (
                <>
                  <ShieldCheck className="size-3 text-emerald-300" aria-hidden="true" />
                  {selectedAgent.name} - {selectedAgent.network.replace('solana-', '')}
                </>
              ) : (
                <>
                  <AlertTriangle className="size-3 text-amber-300" aria-hidden="true" />
                  Select seller identity
                </>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-brand/25 bg-brand/5 p-4 text-xs leading-5 text-fg-muted">
            <div className="flex items-start gap-2">
              <Link2 className="mt-0.5 size-4 shrink-0 text-brand-strong" aria-hidden="true" />
              <p>
                Need a payable endpoint first? Create it on{' '}
                <a href="/creator/monetize" className="text-brand hover:underline">
                  Monetize endpoint
                </a>
                , then come back to publish it here.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={onPublish} disabled={busy || !canPublish}>
              {busy ? 'Publishing...' : 'Publish to discovery'}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden="true" /> Back to source
            </Button>
            {!isDraftComplete(draft) ? (
              <p className="text-[11px] text-fg-subtle">
                Add name, slug, description, provider URL, and at least one payable endpoint.
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

function PayableEndpointEditor({
  draft,
  setDraft,
  updateEndpoint,
  updateEndpointPricing,
  toggleEndpointCurrency,
}: {
  draft: ListingDraft;
  setDraft: React.Dispatch<React.SetStateAction<ListingDraft>>;
  updateEndpoint: (index: number, patch: Partial<ListingEndpoint>) => void;
  updateEndpointPricing: (index: number, patch: Partial<ListingPricing>) => void;
  toggleEndpointCurrency: (index: number, currency: StableCurrency) => void;
}) {
  return (
    <div>
      <Label>Payable endpoints</Label>
      <ul className="mt-2 divide-y divide-border rounded-md border bg-bg/40 text-xs">
        {draft.endpoints.length === 0 ? (
          <li className="px-3 py-3 text-fg-subtle">
            No payable endpoints yet. Add a hosted x402/MPP endpoint from Monetize endpoint, or add
            one by hand.
          </li>
        ) : (
          draft.endpoints.map((endpoint, index) => {
            const pricing = endpoint.pricing ?? draft.pricing;
            const protocol = (endpoint.protocol?.[0] ?? 'x402') as PaymentRail;
            const supported = endpoint.supported_usd ?? ['USDC'];
            return (
              <li key={`${endpoint.method}-${endpoint.url}-${index}`} className="space-y-3 p-3">
                <div className="grid gap-2 md:grid-cols-[90px_minmax(0,1fr)_auto]">
                  <select
                    aria-label={`Endpoint ${index + 1} method`}
                    value={endpoint.method}
                    onChange={(e) =>
                      updateEndpoint(index, { method: e.target.value as 'GET' | 'POST' })
                    }
                    className={cn(SELECT_CLASS, 'font-mono text-xs')}
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </select>
                  <Input
                    value={endpoint.url}
                    onChange={(e) => updateEndpoint(index, { url: e.target.value })}
                    type="url"
                    inputMode="url"
                    className="font-mono text-[11px]"
                    placeholder="https://api.leash.market/x/your-endpoint"
                    aria-label={`Endpoint ${index + 1} URL`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        endpoints: d.endpoints.filter((_, j) => j !== index),
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
                <Input
                  value={endpoint.description}
                  onChange={(e) => updateEndpoint(index, { description: e.target.value })}
                  placeholder="What this payable endpoint does"
                  aria-label={`Endpoint ${index + 1} description`}
                />
                <div className="grid gap-2 md:grid-cols-4">
                  <select
                    aria-label={`Endpoint ${index + 1} pricing type`}
                    value={pricing.type}
                    onChange={(e) =>
                      updateEndpointPricing(index, {
                        type: e.target.value as ListingPricing['type'],
                      })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="free">Free</option>
                    <option value="per_call">Per call</option>
                    <option value="variable">Variable</option>
                  </select>
                  <Input
                    value={pricing.amount ?? ''}
                    onChange={(e) => updateEndpointPricing(index, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.001"
                    className="font-mono"
                    disabled={pricing.type === 'free'}
                    aria-label={`Endpoint ${index + 1} amount`}
                  />
                  <select
                    aria-label={`Endpoint ${index + 1} currency`}
                    value={(pricing.currency as StableCurrency | undefined) ?? 'USDC'}
                    onChange={(e) => updateEndpointPricing(index, { currency: e.target.value })}
                    className={cn(SELECT_CLASS, 'font-mono')}
                  >
                    {STABLE_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Endpoint ${index + 1} payment rail`}
                    value={protocol}
                    onChange={(e) => updateEndpoint(index, { protocol: [e.target.value] })}
                    className={SELECT_CLASS}
                  >
                    {PAYMENT_RAILS.map((rail) => (
                      <option key={rail.id} value={rail.id}>
                        {rail.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-fg-subtle">Accepted:</span>
                  {STABLE_CURRENCIES.map((c) => {
                    const checked = supported.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleEndpointCurrency(index, c)}
                        className={cn(
                          'min-h-9 rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
                          checked
                            ? 'border-brand bg-brand/15 text-brand-strong'
                            : 'border-border text-fg-muted hover:border-border-strong',
                        )}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })
        )}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() =>
          setDraft((d) => ({
            ...d,
            endpoints: [
              ...d.endpoints,
              {
                method: 'POST',
                url: '',
                description: '',
                pricing: d.pricing,
                protocol: ['x402'],
                supported_usd: ['USDC'],
              },
            ],
          }))
        }
      >
        + Add payable endpoint
      </Button>
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
          <ShieldCheck className="size-4 text-brand-strong" aria-hidden="true" />
          <CardTitle>Seller identity</CardTitle>
        </div>
        <CardDescription>
          New native listings are anchored to an agent identity for trust checks and reputation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field id="seller-agent" label="Agent identity">
          <select
            id="seller-agent"
            value={selectedAgentMint}
            onChange={(event) => setSelectedAgentMint(event.target.value)}
            disabled={busy || agents.length === 0}
            className={SELECT_CLASS}
          >
            {busy ? <option value="">Loading identities...</option> : null}
            {!busy && agents.length === 0 ? (
              <option value="">No agent identities found</option>
            ) : null}
            {agents.map((agent) => (
              <option key={agent.mint} value={agent.mint}>
                {agent.name} - {agent.network.replace('solana-', '')} - {shortMint(agent.mint)}
              </option>
            ))}
          </select>
        </Field>
        {error ? (
          <InlineError message={error} />
        ) : agents.length === 0 && !busy ? (
          <p className="text-xs text-fg-muted">
            Create an agent identity first, then return here to list the capability.{' '}
            <a className="text-brand hover:underline" href={`${NEXT_PUBLIC_AGENTS_URL}/profile`}>
              Open agents
            </a>
          </p>
        ) : (
          <p className="text-xs text-fg-muted">
            This identity is shown on marketplace cards and verification decisions.
          </p>
        )}
      </CardContent>
    </Card>
  );
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
          <CheckCircle2 className="mx-auto size-7 text-emerald-300" aria-hidden="true" />
          <CardTitle className="text-2xl">Capability listed</CardTitle>
          <CardDescription className="mx-auto max-w-xl">
            <strong>{draft.name}</strong> is live in marketplace discovery with{' '}
            {draft.endpoints.length} payable endpoint{draft.endpoints.length === 1 ? '' : 's'}.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => router.push('/creator/tools')}>
          Go to my capabilities <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="outline" onClick={() => router.push('/creator/monetize')}>
          Monetize another endpoint
        </Button>
      </div>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function formatPricing(pricing: ListingPricing): string {
  if (pricing.type === 'free') return 'Free';
  if (pricing.type === 'variable') return 'Variable';
  return `${pricing.amount ?? '?'} ${pricing.currency ?? 'USDC'}`;
}

type SearchParamReader = { get(name: string): string | null };

function pricingFromParams(params: SearchParamReader): ListingPricing {
  const rawType = params.get('endpoint_pricing_type');
  const type: ListingPricing['type'] =
    rawType === 'free' || rawType === 'variable' ? rawType : 'per_call';
  return {
    type,
    ...(params.get('endpoint_amount') ? { amount: params.get('endpoint_amount')! } : {}),
    currency: params.get('endpoint_currency') ?? 'USDC',
  };
}

function supportedFromParams(params: SearchParamReader): string[] {
  const raw = params.get('endpoint_supported_usd');
  if (!raw) return ['USDC'];
  return raw
    .split(',')
    .map((currency) => currency.trim())
    .filter(Boolean);
}

function titleFromDescription(description: string): string {
  return description.split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
}

function originFromUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

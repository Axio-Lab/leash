'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2, Link2, Sparkles } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SafeSelect } from '@/components/ui/safe-select';
import { cn } from '@/lib/cn';
import {
  EMPTY_DRAFT,
  isDraftComplete,
  slugify,
  type ListingDraft,
  type ListingEndpoint,
  type ListingPricing,
} from '@/lib/listing-helper';
import { privyAuthedFetch } from '@/lib/privy-fetch';
import {
  PAYMENT_RAILS,
  STABLE_CURRENCIES,
  type PaymentRail,
  type StableCurrency,
} from '@/lib/seller-kit';

type Stage = 'review' | 'submitted';
type PaymentLinkInspectResult = {
  id: string;
  label: string;
  description: string | null;
  owner_agent: string;
  method: 'GET' | 'POST';
  protocol: PaymentRail;
  price: string;
  currency: StableCurrency;
  accepts_currencies: StableCurrency[];
  metadata?: Record<string, unknown>;
};

/**
 * Discovery-only creator flow:
 *   1. Build provider metadata by hand.
 *   2. Paste one or more payable endpoints and read their payment metadata.
 *   3. Publish the listing directly to marketplace discovery.
 */
export default function CreatorListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getAccessToken } = usePrivy();

  const [stage, setStage] = React.useState<Stage>('review');
  const [draft, setDraft] = React.useState<ListingDraft>(() => blankDraft());
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [selectedAgentMint, setSelectedAgentMint] = React.useState('');
  const appliedPrefill = React.useRef(false);

  React.useEffect(() => {
    if (appliedPrefill.current) return;
    const endpointUrl = searchParams.get('endpoint_url');
    if (!endpointUrl) return;
    appliedPrefill.current = true;
    const endpointDescription = searchParams.get('endpoint_description') ?? 'Payable endpoint';
    const providerUrl = searchParams.get('provider_url') ?? originFromUrl(endpointUrl);
    const pricing = pricingFromParams(searchParams);
    const ownerAgent = searchParams.get('endpoint_owner_agent') ?? '';
    if (ownerAgent) setSelectedAgentMint(ownerAgent);
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
          protocol: [searchParams.get('endpoint_protocol') === 'mpp' ? 'mpp' : 'x402'],
          supported_usd: supportedFromParams(searchParams),
        },
      ],
      freeTier: 0,
    });
    setStage('review');
  }, [searchParams]);

  async function publishListing() {
    setError(null);
    if (!selectedAgentMint) {
      setError('Paste a Leash payable endpoint first so we can read its owner identity.');
      return;
    }
    const discoveryPricing = draft.endpoints[0]?.pricing ?? draft.pricing;
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
          pricing: discoveryPricing,
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

      {stage === 'review' ? (
        <ReviewStage
          draft={draft}
          setDraft={setDraft}
          selectedAgentMint={selectedAgentMint}
          setSelectedAgentMint={setSelectedAgentMint}
          error={error}
          onPublish={publishListing}
          busy={busy}
          getAccessToken={getAccessToken}
        />
      ) : null}

      {stage === 'submitted' ? <SubmittedStage draft={draft} router={router} /> : null}
    </div>
  );
}

function ReviewStage({
  draft,
  setDraft,
  selectedAgentMint,
  setSelectedAgentMint,
  error,
  onPublish,
  busy,
  getAccessToken,
}: {
  draft: ListingDraft;
  setDraft: React.Dispatch<React.SetStateAction<ListingDraft>>;
  selectedAgentMint: string;
  setSelectedAgentMint: React.Dispatch<React.SetStateAction<string>>;
  error: string | null;
  onPublish: () => void;
  busy: boolean;
  getAccessToken: () => Promise<string | null>;
}) {
  const [inspectErrors, setInspectErrors] = React.useState<Record<number, string>>({});
  const [inspecting, setInspecting] = React.useState<Record<number, boolean>>({});
  const inspectedUrls = React.useRef<Record<number, string>>({});
  const canPublish = isDraftComplete(draft) && selectedAgentMint.length > 0;

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

  const applyEndpointMetadata = React.useCallback(
    (index: number, url: string, link: PaymentLinkInspectResult) => {
      const pricing = pricingFromPaymentLink(link);
      const providerUrl = providerUrlFromPaymentLink(link) || originFromUrl(url);
      setSelectedAgentMint((current) => current || link.owner_agent);
      setDraft((d) => ({
        ...d,
        endpoint: d.endpoint || providerUrl || d.endpoint,
        pricing: index === 0 ? pricing : d.pricing,
        endpoints: d.endpoints.map((endpoint, j) =>
          j === index
            ? {
                ...endpoint,
                method: link.method,
                description:
                  endpoint.description && endpoint.description !== 'Payable endpoint'
                    ? endpoint.description
                    : link.description || link.label,
                pricing,
                protocol: [link.protocol],
                supported_usd: stableCurrenciesFromPaymentLink(link),
              }
            : endpoint,
        ),
      }));
    },
    [setDraft, setSelectedAgentMint],
  );

  const inspectEndpoint = React.useCallback(
    async (index: number, url: string) => {
      if (!url.trim()) return;
      inspectedUrls.current[index] = url;
      setInspecting((current) => ({ ...current, [index]: true }));
      setInspectErrors((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
      try {
        const res = await privyAuthedFetch(getAccessToken, '/api/payment-links/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const body = (await res.json().catch(() => null)) as
          | PaymentLinkInspectResult
          | { message?: string; error?: string }
          | null;
        if (!res.ok || !body || !('owner_agent' in body)) {
          const err = body && !('owner_agent' in body) ? body : null;
          throw new Error(err?.message ?? err?.error ?? `HTTP ${res.status}`);
        }
        applyEndpointMetadata(index, url, body as PaymentLinkInspectResult);
      } catch (err) {
        setInspectErrors((current) => ({ ...current, [index]: (err as Error).message }));
      } finally {
        setInspecting((current) => ({ ...current, [index]: false }));
      }
    },
    [applyEndpointMetadata, getAccessToken],
  );

  React.useEffect(() => {
    const timers = draft.endpoints.map((endpoint, index) => {
      const url = endpoint.url.trim();
      if (!url || inspectedUrls.current[index] === url || !/^https?:\/\//i.test(url)) return null;
      return window.setTimeout(() => {
        void inspectEndpoint(index, url);
      }, 700);
    });
    return () => {
      timers.forEach((timer) => {
        if (timer) window.clearTimeout(timer);
      });
    };
  }, [draft.endpoints, inspectEndpoint]);

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
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

            <PayableEndpointEditor
              draft={draft}
              setDraft={setDraft}
              updateEndpoint={updateEndpoint}
              updateEndpointPricing={updateEndpointPricing}
              toggleEndpointCurrency={toggleEndpointCurrency}
              inspectEndpoint={inspectEndpoint}
              inspectErrors={inspectErrors}
              inspecting={inspecting}
            />

            {error ? <InlineError message={error} /> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 self-start lg:sticky lg:top-20">
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
              <Badge
                variant={
                  (draft.endpoints[0]?.pricing ?? draft.pricing).type === 'free' ? 'free' : 'paid'
                }
              >
                {formatPricing(draft.endpoints[0]?.pricing ?? draft.pricing)}
              </Badge>
            </div>
            <div className="font-semibold">{draft.name || 'Untitled capability'}</div>
            <p className="line-clamp-3 text-xs text-fg-muted">
              {draft.description || 'Add a one-line description.'}
            </p>
            <div className="text-[11px] text-fg-subtle">
              {draft.endpoints.length} payable endpoint{draft.endpoints.length === 1 ? '' : 's'}
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
            {!isDraftComplete(draft) ? (
              <p className="text-[11px] text-fg-subtle">
                Add name, slug, description, provider URL, and at least one payable endpoint.
              </p>
            ) : null}
            {isDraftComplete(draft) && !selectedAgentMint ? (
              <p className="text-[11px] text-fg-subtle">
                Paste a Leash payable endpoint so the listing can use its owner identity.
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
  inspectEndpoint,
  inspectErrors,
  inspecting,
}: {
  draft: ListingDraft;
  setDraft: React.Dispatch<React.SetStateAction<ListingDraft>>;
  updateEndpoint: (index: number, patch: Partial<ListingEndpoint>) => void;
  updateEndpointPricing: (index: number, patch: Partial<ListingPricing>) => void;
  toggleEndpointCurrency: (index: number, currency: StableCurrency) => void;
  inspectEndpoint: (index: number, url: string) => Promise<void>;
  inspectErrors: Record<number, string>;
  inspecting: Record<number, boolean>;
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
              <li
                key={`${endpoint.method}-${endpoint.url}-${index}`}
                className="min-w-0 space-y-3 p-3"
              >
                <div className="grid min-w-0 gap-2 md:grid-cols-[90px_minmax(0,1fr)_auto]">
                  <SafeSelect
                    aria-label={`Endpoint ${index + 1} method`}
                    value={endpoint.method}
                    onChange={(value) => updateEndpoint(index, { method: value as 'GET' | 'POST' })}
                    options={[
                      { value: 'POST', label: 'POST' },
                      { value: 'GET', label: 'GET' },
                    ]}
                    buttonClassName="font-mono text-xs"
                  />
                  <Input
                    value={endpoint.url}
                    onChange={(e) => updateEndpoint(index, { url: e.target.value })}
                    onBlur={() => void inspectEndpoint(index, endpoint.url)}
                    type="url"
                    inputMode="url"
                    className="min-w-0 font-mono text-[11px]"
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
                {inspecting[index] ? (
                  <p className="text-[11px] text-fg-muted">Reading payment metadata...</p>
                ) : null}
                {inspectErrors[index] ? <InlineError message={inspectErrors[index]} /> : null}
                <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SafeSelect
                    aria-label={`Endpoint ${index + 1} pricing type`}
                    value={pricing.type}
                    onChange={(value) =>
                      updateEndpointPricing(index, {
                        type: value as ListingPricing['type'],
                      })
                    }
                    options={[
                      { value: 'free', label: 'Free' },
                      { value: 'per_call', label: 'Per call' },
                      { value: 'variable', label: 'Variable' },
                    ]}
                  />
                  <Input
                    value={pricing.amount ?? ''}
                    onChange={(e) => updateEndpointPricing(index, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.001"
                    className="font-mono"
                    disabled={pricing.type === 'free'}
                    aria-label={`Endpoint ${index + 1} amount`}
                  />
                  <SafeSelect
                    aria-label={`Endpoint ${index + 1} currency`}
                    value={(pricing.currency as StableCurrency | undefined) ?? 'USDC'}
                    onChange={(value) =>
                      updateEndpointPricing(index, { currency: value as StableCurrency })
                    }
                    options={STABLE_CURRENCIES.map((c) => ({ value: c, label: c }))}
                    buttonClassName="font-mono"
                  />
                  <SafeSelect
                    aria-label={`Endpoint ${index + 1} payment rail`}
                    value={protocol}
                    onChange={(value) =>
                      updateEndpoint(index, { protocol: [value as PaymentRail] })
                    }
                    options={PAYMENT_RAILS.map((rail) => ({
                      value: rail.id,
                      label: rail.label,
                      description: rail.description,
                    }))}
                  />
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
                description: 'Payable endpoint',
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

function formatPricing(pricing: ListingPricing): string {
  if (pricing.type === 'free') return 'Free';
  if (pricing.type === 'variable') return 'Variable';
  return `${pricing.amount ?? '?'} ${pricing.currency ?? 'USDC'}`;
}

type SearchParamReader = { get(name: string): string | null };

function blankDraft(): ListingDraft {
  return {
    ...EMPTY_DRAFT,
    endpoints: [
      {
        method: 'POST',
        url: '',
        description: 'Payable endpoint',
        pricing: EMPTY_DRAFT.pricing,
        protocol: ['x402'],
        supported_usd: ['USDC'],
      },
    ],
  };
}

function pricingFromParams(params: SearchParamReader): ListingPricing {
  const rawType = params.get('endpoint_pricing_type');
  const type: ListingPricing['type'] =
    rawType === 'free' || rawType === 'variable' ? rawType : 'per_call';
  const rawCurrency = params.get('endpoint_currency');
  const currency: StableCurrency = STABLE_CURRENCIES.includes(rawCurrency as StableCurrency)
    ? (rawCurrency as StableCurrency)
    : 'USDC';
  return {
    type,
    ...(params.get('endpoint_amount') ? { amount: params.get('endpoint_amount')! } : {}),
    currency,
  };
}

function pricingFromPaymentLink(link: PaymentLinkInspectResult): ListingPricing {
  const rawType = link.metadata?.pricing_type;
  const type: ListingPricing['type'] =
    rawType === 'free' || rawType === 'variable' || rawType === 'per_call'
      ? rawType
      : amountFromPrice(link.price) === '0'
        ? 'free'
        : 'per_call';
  if (type === 'free') return { type };
  return {
    type,
    amount: amountFromPrice(link.price),
    currency: link.currency,
  };
}

function stableCurrenciesFromPaymentLink(link: PaymentLinkInspectResult): StableCurrency[] {
  return Array.from(new Set([link.currency, ...link.accepts_currencies])).filter(
    (currency): currency is StableCurrency =>
      (STABLE_CURRENCIES as readonly string[]).includes(currency),
  );
}

function providerUrlFromPaymentLink(link: PaymentLinkInspectResult): string {
  const providerUrl = link.metadata?.provider_url;
  return typeof providerUrl === 'string' ? providerUrl : '';
}

function amountFromPrice(price: string): string {
  const match = price.trim().match(/[0-9]+(?:\.[0-9]+)?/);
  return match?.[0] ?? '0';
}

function supportedFromParams(params: SearchParamReader): StableCurrency[] {
  const raw = params.get('endpoint_supported_usd');
  if (!raw) return ['USDC'];
  return raw
    .split(',')
    .map((currency) => currency.trim())
    .filter((currency): currency is StableCurrency =>
      STABLE_CURRENCIES.includes(currency as StableCurrency),
    );
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

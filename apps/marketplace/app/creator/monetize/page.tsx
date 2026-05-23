'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Link2,
  Radar,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

import { CreateKeyDialog, type CreatedKey } from '@/components/create-key-dialog';
import { ShowKeyOnceModal } from '@/components/show-key-once';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';
import { privyAuthedFetch } from '@/lib/privy-fetch';
import {
  PAYMENT_RAILS,
  STABLE_CURRENCIES,
  type PaymentRail,
  type StableCurrency,
} from '@/lib/seller-kit';

type OwnedAgent = {
  mint: string;
  name: string;
  network: 'solana-devnet' | 'solana-mainnet';
  owner_wallet: string;
};

type CreatorApiKey = {
  id: string;
  name: string;
  network: 'solana-devnet' | 'solana-mainnet';
  prefix: string;
  last4: string;
  scopes: string[];
  disabled_at: string | null;
};

type PaymentLinkResult = {
  id: string;
  share_url: string;
  protocol: PaymentRail;
  method?: 'GET' | 'POST';
  price?: string;
  currency?: StableCurrency;
};

type InspectResult = {
  method: 'GET' | 'POST';
  allowed_methods: string[];
  detail: string;
};

type PricingType = 'free' | 'per_call' | 'variable';

const SELECT_CLASS =
  'min-h-10 w-full min-w-0 max-w-full truncate rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:opacity-50';

export default function CreatorMonetizePage() {
  const router = useRouter();
  const { getAccessToken } = usePrivy();
  const [label, setLabel] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [upstreamUrl, setUpstreamUrl] = React.useState('');
  const [providerUrl, setProviderUrl] = React.useState('');
  const [method, setMethod] = React.useState<'GET' | 'POST'>('POST');
  const [pricingType, setPricingType] = React.useState<PricingType>('per_call');
  const [amount, setAmount] = React.useState('0.001');
  const [currency, setCurrency] = React.useState<StableCurrency>('USDC');
  const [acceptedCurrencies, setAcceptedCurrencies] = React.useState<StableCurrency[]>([
    'USDC',
    'USDT',
    'USDG',
  ]);
  const [freeTier, setFreeTier] = React.useState('0');
  const [rail, setRail] = React.useState<PaymentRail>('x402');
  const [agents, setAgents] = React.useState<OwnedAgent[]>([]);
  const [agentsBusy, setAgentsBusy] = React.useState(true);
  const [agentsError, setAgentsError] = React.useState<string | null>(null);
  const [selectedAgentMint, setSelectedAgentMint] = React.useState('');
  const [apiKeys, setApiKeys] = React.useState<CreatorApiKey[]>([]);
  const [apiKeysBusy, setApiKeysBusy] = React.useState(true);
  const [apiKeysError, setApiKeysError] = React.useState<string | null>(null);
  const [selectedApiKeyId, setSelectedApiKeyId] = React.useState('');
  const [inspectBusy, setInspectBusy] = React.useState(false);
  const [inspectResult, setInspectResult] = React.useState<InspectResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [paymentLink, setPaymentLink] = React.useState<PaymentLinkResult | null>(null);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);
  const [createdKey, setCreatedKey] = React.useState<CreatedKey | null>(null);

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

  const loadApiKeys = React.useCallback(async () => {
    setApiKeysBusy(true);
    setApiKeysError(null);
    try {
      const res = await privyAuthedFetch(getAccessToken, '/api/keys');
      const body = (await res.json().catch(() => null)) as {
        items?: CreatorApiKey[];
        message?: string;
      } | null;
      if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
      const active = (body?.items ?? []).filter(
        (key) => !key.disabled_at && key.scopes.includes('marketplace'),
      );
      setApiKeys(active);
      setSelectedApiKeyId((current) => current || active[0]?.id || '');
    } catch (err) {
      setApiKeysError((err as Error).message);
    } finally {
      setApiKeysBusy(false);
    }
  }, [getAccessToken]);

  React.useEffect(() => {
    void loadApiKeys();
  }, [loadApiKeys]);

  React.useEffect(() => {
    if (providerUrl.trim().length > 0) return;
    const origin = originFromUrl(upstreamUrl);
    if (origin) setProviderUrl(origin);
  }, [providerUrl, upstreamUrl]);

  const selectedAgent = agents.find((agent) => agent.mint === selectedAgentMint) ?? null;
  const canCreate =
    label.trim().length > 0 &&
    upstreamUrl.trim().length > 0 &&
    selectedAgent != null &&
    selectedApiKeyId.length > 0 &&
    !agentsBusy &&
    !apiKeysBusy &&
    (pricingType === 'free' || amount.trim().length > 0);

  async function inspectEndpoint() {
    setInspectBusy(true);
    setInspectResult(null);
    setError(null);
    try {
      const res = await privyAuthedFetch(getAccessToken, '/api/endpoint-inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: upstreamUrl }),
      });
      const body = (await res.json().catch(() => null)) as
        | InspectResult
        | { message?: string }
        | null;
      if (!res.ok || !body || !('method' in body)) {
        throw new Error(body && 'message' in body ? body.message : `HTTP ${res.status}`);
      }
      setMethod(body.method);
      setInspectResult(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInspectBusy(false);
    }
  }

  async function createPaymentLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPaymentLink(null);
    try {
      if (!selectedApiKeyId) throw new Error('Select or create a marketplace API key.');
      if (!selectedAgentMint) throw new Error('Select the seller identity for this endpoint.');
      const quotedAmount = pricingType === 'free' ? '0' : amount.trim();
      const response = {
        status: 200,
        mimeType: 'application/json',
        body: {
          ok: true,
          message: 'Payment accepted. Call the protected endpoint to receive live data.',
          upstream_url: upstreamUrl,
        },
      };
      const res = await privyAuthedFetch(getAccessToken, '/api/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key_id: selectedApiKeyId,
          id: slugFromLabel(label),
          label: label.trim(),
          description: description.trim() || undefined,
          owner_agent: selectedAgentMint,
          method,
          protocol: rail,
          price: `${quotedAmount} ${currency}`,
          currency,
          accepts_currencies: acceptedCurrencies.filter((c) => c !== currency),
          response,
          metadata: {
            upstream_url: upstreamUrl,
            provider_url: providerUrl || originFromUrl(upstreamUrl),
            pricing_type: pricingType,
            free_tier: Number(freeTier || 0),
          },
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | PaymentLinkResult
        | { message?: string; error?: string }
        | null;
      if (!res.ok || !body || !('share_url' in body)) {
        const err = body && !('share_url' in body) ? body : null;
        throw new Error(err?.message ?? err?.error ?? `HTTP ${res.status}`);
      }
      setPaymentLink(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addToDiscovery() {
    if (!paymentLink) return;
    const params = new URLSearchParams({
      provider_url: providerUrl || originFromUrl(upstreamUrl) || upstreamUrl,
      endpoint_url: paymentLink.share_url,
      endpoint_method: method,
      endpoint_description: description.trim() || label.trim(),
      endpoint_pricing_type: pricingType,
      endpoint_currency: currency,
      endpoint_protocol: rail,
      endpoint_supported_usd: acceptedCurrencies.join(','),
    });
    if (pricingType !== 'free') params.set('endpoint_amount', amount.trim());
    router.push(`/creator/list?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <header>
        <Badge
          variant="outline"
          className="border-brand/40 font-mono uppercase tracking-widest text-brand-strong"
        >
          <Link2 className="mr-1.5 size-3" aria-hidden="true" /> Monetize endpoint
        </Badge>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Turn an endpoint into a payable endpoint
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Wrap one upstream HTTP endpoint with a hosted x402 or MPP paywall. After it is live, add
          the payable URL to marketplace discovery from the listing flow.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form onSubmit={createPaymentLink} className="space-y-6" aria-busy={busy}>
          <Card>
            <CardHeader>
              <CardTitle>Endpoint details</CardTitle>
              <CardDescription>
                Start with the raw endpoint you already run. Leash returns a hosted payable URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="endpoint-label" label="Label">
                  <Input
                    id="endpoint-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Premium search"
                    autoComplete="off"
                    required
                  />
                </Field>
                <Field id="provider-url" label="Provider URL">
                  <Input
                    id="provider-url"
                    type="url"
                    inputMode="url"
                    value={providerUrl}
                    onChange={(e) => setProviderUrl(e.target.value)}
                    placeholder="https://api.example.com"
                    className="font-mono text-xs"
                  />
                </Field>
              </div>
              <Field id="endpoint-description" label="Description">
                <Textarea
                  id="endpoint-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Search fresh web results with citations."
                  rows={3}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                <Field id="upstream-url" label="Upstream endpoint URL">
                  <Input
                    id="upstream-url"
                    type="url"
                    inputMode="url"
                    value={upstreamUrl}
                    onChange={(e) => setUpstreamUrl(e.target.value)}
                    placeholder="https://api.example.com/v1/search"
                    className="font-mono text-xs"
                    required
                  />
                </Field>
                <Field id="endpoint-method" label="Method">
                  <select
                    id="endpoint-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
                    className={cn(SELECT_CLASS, 'font-mono')}
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={inspectEndpoint}
                  disabled={inspectBusy || upstreamUrl.trim().length === 0}
                >
                  <Radar className="size-4" aria-hidden="true" />
                  {inspectBusy ? 'Inspecting...' : 'Detect method'}
                </Button>
                {inspectResult ? (
                  <p className="text-xs text-fg-muted">{inspectResult.detail}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment settings</CardTitle>
              <CardDescription>
                Pick the rail and stablecoin settings for the hosted paywall.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="payment-rail" label="Payment rail">
                  <select
                    id="payment-rail"
                    value={rail}
                    onChange={(e) => setRail(e.target.value as PaymentRail)}
                    className={SELECT_CLASS}
                  >
                    {PAYMENT_RAILS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label} - {r.description}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="payment-currency" label="Primary currency">
                  <select
                    id="payment-currency"
                    value={currency}
                    onChange={(e) => {
                      const next = e.target.value as StableCurrency;
                      setCurrency(next);
                      setAcceptedCurrencies((prev) =>
                        prev.includes(next) ? prev : [next, ...prev],
                      );
                    }}
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

              <fieldset className="space-y-2 rounded-lg border bg-bg/40 p-4">
                <legend className="px-1 text-sm font-medium">Pricing type</legend>
                <div className="flex flex-wrap gap-2">
                  {(['free', 'per_call', 'variable'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setPricingType(type)}
                      className={cn(
                        'min-h-10 rounded-md border px-3 py-2 text-xs uppercase tracking-wide transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
                        pricingType === type
                          ? 'border-brand bg-brand/15 text-brand-strong'
                          : 'border-border text-fg-muted hover:border-border-strong',
                      )}
                    >
                      {type.replace('_', ' ')}
                    </button>
                  ))}
                </div>
                {pricingType === 'variable' ? (
                  <p className="text-xs text-fg-muted">
                    Hosted links still need a concrete quote. Use the amount below as this link's
                    current price.
                  </p>
                ) : null}
              </fieldset>

              <div className="grid gap-4 md:grid-cols-2">
                <Field id="payment-amount" label={pricingType === 'free' ? 'Amount' : 'Amount'}>
                  <Input
                    id="payment-amount"
                    value={pricingType === 'free' ? '0' : amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.001"
                    className="font-mono"
                    disabled={pricingType === 'free'}
                  />
                </Field>
                <Field id="free-tier" label="Free tier calls / day">
                  <Input
                    id="free-tier"
                    value={freeTier}
                    onChange={(e) => setFreeTier(e.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                  />
                </Field>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Accepted stablecoins</legend>
                <div className="flex flex-wrap gap-2">
                  {STABLE_CURRENCIES.map((c) => {
                    const checked = acceptedCurrencies.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setAcceptedCurrencies((prev) =>
                            checked ? prev.filter((item) => item !== c) : [...prev, c],
                          )
                        }
                        className={cn(
                          'min-h-10 rounded-md border px-3 py-2 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
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
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Seller identity and key</CardTitle>
              <CardDescription>
                The selected agent owns the paywall. The API key creates the hosted endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {agentsBusy ? (
                <Skeleton className="h-20" />
              ) : agentsError ? (
                <InlineError message={agentsError} />
              ) : (
                <Field id="seller-agent" label="Seller identity">
                  <select
                    id="seller-agent"
                    value={selectedAgentMint}
                    onChange={(event) => setSelectedAgentMint(event.target.value)}
                    disabled={agents.length === 0}
                    className={SELECT_CLASS}
                  >
                    {agents.length === 0 ? (
                      <option value="">No agent identities found</option>
                    ) : null}
                    {agents.map((agent) => (
                      <option key={agent.mint} value={agent.mint}>
                        {agent.name} - {agent.network.replace('solana-', '')} -{' '}
                        {shortMint(agent.mint)}
                      </option>
                    ))}
                  </select>
                  {agents.length === 0 ? (
                    <p className="text-xs text-fg-muted">
                      Create an agent identity first, then return here.{' '}
                      <a
                        className="text-brand hover:underline"
                        href={`${NEXT_PUBLIC_AGENTS_URL}/profile`}
                      >
                        Open agents
                      </a>
                    </p>
                  ) : null}
                </Field>
              )}

              {apiKeysBusy ? (
                <Skeleton className="h-20" />
              ) : apiKeysError ? (
                <InlineError message={apiKeysError} />
              ) : (
                <Field id="api-key" label="Marketplace API key">
                  <select
                    id="api-key"
                    value={selectedApiKeyId}
                    onChange={(event) => setSelectedApiKeyId(event.target.value)}
                    disabled={apiKeys.length === 0}
                    className={SELECT_CLASS}
                  >
                    {apiKeys.length === 0 ? <option value="">No API key found</option> : null}
                    {apiKeys.map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.name} - {key.network.replace('solana-', '')} - {key.prefix}...
                        {key.last4}
                      </option>
                    ))}
                  </select>
                  {apiKeys.length === 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCreateKeyOpen(true)}
                    >
                      Create marketplace API key
                    </Button>
                  ) : null}
                </Field>
              )}

              {error ? <InlineError message={error} /> : null}

              <Button type="submit" disabled={busy || !canCreate} className="w-full sm:w-auto">
                {busy ? 'Creating payable endpoint...' : 'Create payable endpoint'}
              </Button>
            </CardContent>
          </Card>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-20 self-start">
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>What agents will pay to call.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border bg-bg p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={pricingType === 'free' ? 'free' : 'paid'}>
                    {pricingType === 'free' ? 'Free' : `${amount || '?'} ${currency}`}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    {method}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    {rail.toUpperCase()}
                  </Badge>
                </div>
                <div className="mt-3 font-semibold">{label || 'Untitled payable endpoint'}</div>
                <p className="mt-1 text-xs text-fg-muted">
                  {description || 'Add a short description for buyer agents.'}
                </p>
                <code className="mt-3 block break-all rounded-md border bg-bg-elev px-3 py-2 font-mono text-[11px] text-fg-muted">
                  {upstreamUrl || 'https://api.example.com/v1/endpoint'}
                </code>
              </div>
            </CardContent>
          </Card>

          {paymentLink ? (
            <Card className="border-emerald-400/30 bg-emerald-400/10">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-300" aria-hidden="true" />
                  <CardTitle>Payable endpoint is live</CardTitle>
                </div>
                <CardDescription>
                  Add this hosted URL to a marketplace listing when you want agents to discover it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <a
                  href={paymentLink.share_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all rounded-lg border bg-bg px-3 py-2 font-mono text-xs text-brand hover:underline"
                >
                  {paymentLink.share_url}
                </a>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={addToDiscovery}>
                    Add to marketplace discovery{' '}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="outline" asChild>
                    <a href={paymentLink.share_url} target="_blank" rel="noreferrer">
                      Open <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-brand-strong" aria-hidden="true" />
                  <CardTitle>Next step</CardTitle>
                </div>
                <CardDescription>
                  After creation, Leash gives you a hosted `/x/...` endpoint that speaks x402 or
                  MPP.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs leading-5 text-fg-muted">
                You can keep the endpoint private, or publish it through “List capability” with a
                provider URL and agent-readable description.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex items-start gap-2 p-4 text-xs text-fg-muted">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 text-brand-strong"
                aria-hidden="true"
              />
              <p>
                Payment settings live on the hosted payable endpoint. Marketplace listings only
                describe the provider and the payable endpoints agents can call.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <CreateKeyDialog
        open={createKeyOpen}
        onClose={() => setCreateKeyOpen(false)}
        defaultScopes={['marketplace']}
        onCreated={(key) => {
          setCreatedKey(key);
          setSelectedApiKeyId(key.id);
          setCreateKeyOpen(false);
          void loadApiKeys();
        }}
      />
      <ShowKeyOnceModal
        plaintext={createdKey?.plaintext ?? null}
        onClose={() => setCreatedKey(null)}
      />
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

function originFromUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function slugFromLabel(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `endpoint-${Date.now()}`;
}

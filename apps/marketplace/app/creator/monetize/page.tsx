'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Link2,
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
import { SafeSelect } from '@/components/ui/safe-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
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
  owner_agent?: string;
  method?: 'GET' | 'POST';
  price?: string;
  currency?: StableCurrency;
};

type PricingType = 'free' | 'per_call' | 'variable';

type CreatedEndpointDraft = {
  upstreamUrl: string;
  method: 'GET' | 'POST';
  pricingType: PricingType;
  amount: string;
  currency: StableCurrency;
  rail: PaymentRail;
  acceptedCurrencies: StableCurrency[];
  expectedRequestBody?: Record<string, unknown>;
};

export default function CreatorMonetizePage() {
  const router = useRouter();
  const { getAccessToken } = usePrivy();
  const [upstreamUrl, setUpstreamUrl] = React.useState('');
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
  const [expectedBody, setExpectedBody] = React.useState('{}');
  const [agents, setAgents] = React.useState<OwnedAgent[]>([]);
  const [agentsBusy, setAgentsBusy] = React.useState(true);
  const [agentsError, setAgentsError] = React.useState<string | null>(null);
  const [selectedAgentMint, setSelectedAgentMint] = React.useState('');
  const [apiKeys, setApiKeys] = React.useState<CreatorApiKey[]>([]);
  const [apiKeysBusy, setApiKeysBusy] = React.useState(true);
  const [apiKeysError, setApiKeysError] = React.useState<string | null>(null);
  const [selectedApiKeyId, setSelectedApiKeyId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [paymentLink, setPaymentLink] = React.useState<PaymentLinkResult | null>(null);
  const [createdEndpointDraft, setCreatedEndpointDraft] =
    React.useState<CreatedEndpointDraft | null>(null);
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

  const selectedAgent = agents.find((agent) => agent.mint === selectedAgentMint) ?? null;
  const canCreate =
    upstreamUrl.trim().length > 0 &&
    selectedAgent != null &&
    selectedApiKeyId.length > 0 &&
    !agentsBusy &&
    !apiKeysBusy &&
    (pricingType === 'free' || amount.trim().length > 0);

  async function createPaymentLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPaymentLink(null);
    setCreatedEndpointDraft(null);
    try {
      if (!selectedApiKeyId) throw new Error('Select or create a marketplace API key.');
      if (!selectedAgentMint) throw new Error('Select the seller identity for this endpoint.');
      const expectedRequestBody =
        method === 'POST' ? parseExpectedRequestBody(expectedBody) : undefined;
      const quotedAmount = pricingType === 'free' ? '0' : amount.trim();
      const generatedLabel = labelFromUrl(upstreamUrl);
      const createdDraft: CreatedEndpointDraft = {
        upstreamUrl,
        method,
        pricingType,
        amount: amount.trim(),
        currency,
        rail,
        acceptedCurrencies,
        ...(expectedRequestBody !== undefined ? { expectedRequestBody } : {}),
      };
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
          id: slugFromUrl(upstreamUrl),
          label: generatedLabel,
          description: undefined,
          owner_agent: selectedAgentMint,
          method,
          protocol: rail,
          price: `${quotedAmount} ${currency}`,
          currency,
          accepts_currencies: acceptedCurrencies.filter((c) => c !== currency),
          response,
          metadata: {
            upstream_url: upstreamUrl,
            provider_url: originFromUrl(upstreamUrl),
            pricing_type: pricingType,
            free_tier: Number(freeTier || 0),
            ...(expectedRequestBody !== undefined
              ? { expected_request_body: expectedRequestBody }
              : {}),
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
      setCreatedEndpointDraft(createdDraft);
      setUpstreamUrl('');
      setExpectedBody('{}');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addToDiscovery() {
    if (!paymentLink || !createdEndpointDraft) return;
    const generatedLabel = labelFromUrl(createdEndpointDraft.upstreamUrl);
    const params = new URLSearchParams({
      provider_url:
        originFromUrl(createdEndpointDraft.upstreamUrl) || createdEndpointDraft.upstreamUrl,
      endpoint_url: paymentLink.share_url,
      endpoint_method: paymentLink.method ?? createdEndpointDraft.method,
      endpoint_description: generatedLabel,
      endpoint_owner_agent: paymentLink.owner_agent ?? selectedAgentMint,
      endpoint_pricing_type: createdEndpointDraft.pricingType,
      endpoint_currency: createdEndpointDraft.currency,
      endpoint_protocol: createdEndpointDraft.rail,
      endpoint_supported_usd: createdEndpointDraft.acceptedCurrencies.join(','),
    });
    if (createdEndpointDraft.pricingType !== 'free') {
      params.set('endpoint_amount', createdEndpointDraft.amount);
    }
    if (createdEndpointDraft.expectedRequestBody !== undefined) {
      params.set(
        'endpoint_expected_body',
        JSON.stringify(createdEndpointDraft.expectedRequestBody),
      );
    }
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
          Make your existing endpoint payable
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Paste the URL you already run, choose payment settings, and Leash returns a hosted x402 or
          MPP payable URL.
        </p>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form onSubmit={createPaymentLink} className="min-w-0 space-y-6" aria-busy={busy}>
          <Card>
            <CardHeader>
              <CardTitle>Existing endpoint</CardTitle>
              <CardDescription>
                Provide the current URL for the endpoint you want to monetize.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
              <Field id="upstream-url" label="Existing endpoint URL">
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
              <Field id="endpoint-method" label="Request type">
                <SafeSelect
                  id="endpoint-method"
                  value={method}
                  onChange={(value) => setMethod(value as 'GET' | 'POST')}
                  options={[
                    { value: 'POST', label: 'POST' },
                    { value: 'GET', label: 'GET' },
                  ]}
                  buttonClassName="font-mono"
                />
              </Field>
            </CardContent>
          </Card>

          {method === 'POST' ? (
            <Card>
              <CardHeader>
                <CardTitle>Expected request body</CardTitle>
                <CardDescription>
                  Describe the JSON object buyers should send when they call the hosted payable URL.
                  This is metadata only; the buyer sends the real body at payment time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="expected-body">Expected body JSON</Label>
                <Textarea
                  id="expected-body"
                  value={expectedBody}
                  onChange={(e) => setExpectedBody(e.target.value)}
                  rows={7}
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder='{"prompt":"string","style":"string"}'
                  aria-describedby="expected-body-help"
                />
                <p id="expected-body-help" className="text-xs text-fg-muted">
                  Use any JSON object shape your endpoint expects, for example{' '}
                  <code className="font-mono">{'{"prompt":"string"}'}</code>. Leave as{' '}
                  <code className="font-mono">{'{}'}</code> if callers can send any body.
                </p>
              </CardContent>
            </Card>
          ) : null}

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
                  <SafeSelect
                    id="payment-rail"
                    value={rail}
                    onChange={(value) => setRail(value as PaymentRail)}
                    options={PAYMENT_RAILS.map((r) => ({
                      value: r.id,
                      label: r.label,
                      description: r.description,
                    }))}
                  />
                  <p className="text-xs text-fg-muted">
                    {PAYMENT_RAILS.find((r) => r.id === rail)?.description}
                  </p>
                </Field>
                <Field id="payment-currency" label="Primary currency">
                  <SafeSelect
                    id="payment-currency"
                    value={currency}
                    onChange={(value) => {
                      const next = value as StableCurrency;
                      setCurrency(next);
                      setAcceptedCurrencies((prev) =>
                        prev.includes(next) ? prev : [next, ...prev],
                      );
                    }}
                    options={STABLE_CURRENCIES.map((c) => ({ value: c, label: c }))}
                    buttonClassName="font-mono"
                  />
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
                  <SafeSelect
                    id="seller-agent"
                    value={selectedAgentMint}
                    onChange={setSelectedAgentMint}
                    disabled={agents.length === 0}
                    placeholder="No agent identities found"
                    options={agents.map((agent) => ({
                      value: agent.mint,
                      label: `${compactLabel(agent.name)} - ${agent.network.replace(
                        'solana-',
                        '',
                      )} - ${shortMint(agent.mint)}`,
                      description: agent.mint,
                    }))}
                  />
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
                  <SafeSelect
                    id="api-key"
                    value={selectedApiKeyId}
                    onChange={setSelectedApiKeyId}
                    disabled={apiKeys.length === 0}
                    placeholder="No API key found"
                    options={apiKeys.map((key) => ({
                      value: key.id,
                      label: `${compactLabel(key.name)} - ${key.network.replace('solana-', '')} - ${
                        key.prefix
                      }...${key.last4}`,
                    }))}
                  />
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
                {busy ? (
                  <>
                    <Spinner size="xs" className="text-white" />
                    Creating payable endpoint...
                  </>
                ) : (
                  'Create payable endpoint'
                )}
              </Button>
            </CardContent>
          </Card>
        </form>

        <aside className="min-w-0 space-y-4 self-start lg:sticky lg:top-20">
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

function compactLabel(value: string): string {
  return value.length > 28 ? `${value.slice(0, 25)}...` : value;
}

function originFromUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function labelFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return 'Payable endpoint';
  }
}

function slugFromUrl(value: string): string {
  const slug = labelFromUrl(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `endpoint-${Date.now()}`;
}

function parseExpectedRequestBody(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isPlainObject(parsed)) {
      throw new Error('Expected request body must be a JSON object like {}.');
    }
    return parsed;
  } catch (err) {
    if (err instanceof Error && err.message.includes('JSON object')) throw err;
    throw new Error('Expected request body must be valid JSON, for example {"prompt":"string"}.');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

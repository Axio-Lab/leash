'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import {
  Bot,
  Copy,
  ExternalLink,
  Globe2,
  Link as LinkIcon,
  Loader2,
  Plus,
  Receipt,
  Trash2,
} from 'lucide-react';
import type { EndpointV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { InlineCode } from '@/components/ui/code';
import { listAgents, type StoredAgent } from '@/lib/agent-storage';

type Method = 'GET' | 'POST';

const ENDPOINTS_KEY = '/api/endpoints';
const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

/**
 * Seller payment-link builder.
 *
 * The "Stripe Payment Links" surface for x402 on Solana. Pick one of your
 * agents, declare a method + path + price, define the response template,
 * save it. The runner persists the descriptor and `/x/<id>` becomes a
 * live x402 paywall served by `@leash/seller-kit`.
 */
export default function SellerPage() {
  const [agents, setAgents] = React.useState<
    Array<Pick<StoredAgent, 'mint' | 'label' | 'network'>>
  >([]);
  const [ownerAgent, setOwnerAgent] = React.useState('');
  const [label, setLabel] = React.useState('Premium echo');
  const [description, setDescription] = React.useState(
    'Echoes the request body back to paying agents.',
  );
  const [method, setMethod] = React.useState<Method>('POST');
  const [price, setPrice] = React.useState('$0.001');
  const [bodyJson, setBodyJson] = React.useState('{"ok":true,"hello":"leash"}');
  const [customId, setCustomId] = React.useState('');
  const [redirectUrl, setRedirectUrl] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [wrapReceipt, setWrapReceipt] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [origin, setOrigin] = React.useState('');

  React.useEffect(() => {
    const a = listAgents();
    setAgents(a);
    if (a[0]?.mint && !ownerAgent) setOwnerAgent(a[0].mint);
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, [ownerAgent]);

  const ownerEndpointsKey = ownerAgent
    ? `${ENDPOINTS_KEY}?owner_agent=${encodeURIComponent(ownerAgent)}`
    : null;
  const { data, error: listError } = useSWR<{ endpoints: EndpointV1[] }>(
    ownerEndpointsKey,
    fetcher,
    { refreshInterval: 5000 },
  );
  const links = data?.endpoints ?? [];

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ownerAgent) {
      setError('Pick an agent to receive payments.');
      return;
    }
    let parsedBody: unknown;
    try {
      parsedBody = bodyJson.trim() ? JSON.parse(bodyJson) : { ok: true };
    } catch (err) {
      setError(`Response body must be valid JSON: ${(err as Error).message}`);
      return;
    }
    setSubmitting(true);
    try {
      const idCandidate = customId.trim().toLowerCase();
      const ownerStored = agents.find((a) => a.mint === ownerAgent);
      const network =
        ownerStored?.network === 'solana-mainnet' ? 'solana-mainnet' : 'solana-devnet';
      const res = await fetch(ENDPOINTS_KEY, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(idCandidate ? { id: idCandidate } : {}),
          label: label.trim(),
          description: description.trim() || undefined,
          owner_agent: ownerAgent,
          method,
          price: price.trim(),
          network,
          response: {
            status: 200,
            mimeType: 'application/json',
            body: parsedBody,
          },
          redirect_url: redirectUrl.trim() || undefined,
          webhook_url: webhookUrl.trim() || undefined,
          wrap_receipt: wrapReceipt,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        endpoint?: EndpointV1;
        error?: string;
        detail?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.detail ?? json?.error ?? `runner returned ${res.status}`);
      }
      setCustomId('');
      setRedirectUrl('');
      setWebhookUrl('');
      await mutate(ownerEndpointsKey);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLink(id: string) {
    if (!confirm(`Delete payment link "${id}"? Existing buyers will get 404.`)) return;
    await fetch(`${ENDPOINTS_KEY}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await mutate(ownerEndpointsKey);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/seller-kit"
        title="Payment-link builder"
        description="Mint shareable x402 payment links. Pick one of your agents, declare a price + response, and the runner gives you back a public URL — anything that speaks x402 (including @leash/buyer-kit) can pay it."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <InfoCard label="Surface" value="POST/GET /x/<id>" />
        <InfoCard label="Network" value="solana-devnet" />
        <InfoCard label="Facilitator" value="facilitator.svmacc.tech" />
        <InfoCard label="Receives at" value="Asset Signer PDA (auto)" />
      </section>

      {agents.length === 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col gap-3 py-4">
            <p className="text-sm">
              You don&apos;t have any agents on this device yet. Mint one — the agent&apos;s Asset
              Signer PDA becomes the <code className="font-mono">payTo</code> for every payment link
              you create.
            </p>
            <Button asChild className="w-fit">
              <Link href="/agents/new">
                <Plus className="size-4" /> Create agent
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="size-4 text-brand" /> New payment link
              </CardTitle>
              <CardDescription>
                The runner stores the descriptor; <InlineCode>/x/&lt;id&gt;</InlineCode> serves it
                with the real <InlineCode>@leash/seller-kit</InlineCode> middleware.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={createLink}>
                <Field label="Agent (receives payments)">
                  <select
                    value={ownerAgent}
                    onChange={(e) => setOwnerAgent(e.target.value)}
                    className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm"
                  >
                    {agents.map((a) => (
                      <option key={a.mint} value={a.mint}>
                        {a.label ?? `${a.mint.slice(0, 4)}…${a.mint.slice(-4)}`} · {a.network}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Label">
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Premium echo"
                  />
                </Field>

                <Field label="Description (optional)">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Method">
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value as Method)}
                      className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm"
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </select>
                  </Field>
                  <Field label="Price (USDC)">
                    <Input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="font-mono"
                      placeholder="$0.001"
                    />
                  </Field>
                </div>

                <Field label="Custom slug (optional)">
                  <Input
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                    placeholder="auto-generated if empty"
                    className="font-mono lowercase"
                  />
                </Field>

                <Field label="Response body (JSON)">
                  <Textarea
                    value={bodyJson}
                    onChange={(e) => setBodyJson(e.target.value)}
                    rows={5}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </Field>

                <Separator />

                <h3 className="text-xs font-medium uppercase tracking-widest text-fg-subtle">
                  Post-payment hooks (all optional)
                </h3>

                <Field label="Redirect URL (303 after payment)">
                  <Input
                    value={redirectUrl}
                    onChange={(e) => setRedirectUrl(e.target.value)}
                    placeholder="https://yoursite.com/thank-you"
                    type="url"
                    className="font-mono text-xs"
                  />
                  <span className="text-[11px] text-fg-subtle">
                    Receives <InlineCode>?leash_tx</InlineCode>,{' '}
                    <InlineCode>?leash_receipt</InlineCode>, <InlineCode>?leash_agent</InlineCode>{' '}
                    appended automatically.
                  </span>
                </Field>

                <Field label="Webhook URL (fire-and-forget POST)">
                  <Input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-agent.com/leash-callback"
                    type="url"
                    className="font-mono text-xs"
                  />
                  <span className="text-[11px] text-fg-subtle">
                    Receives <InlineCode>{'{ payment, response }'}</InlineCode> JSON. Buyers can add
                    a per-call <InlineCode>x-leash-callback</InlineCode> header to fire one of their
                    own.
                  </span>
                </Field>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={wrapReceipt}
                    onChange={(e) => setWrapReceipt(e.target.checked)}
                    className="mt-1 size-3.5"
                  />
                  <span>
                    <span className="block">Embed receipt in JSON response</span>
                    <span className="block text-[11px] text-fg-subtle">
                      Wraps the body as{' '}
                      <InlineCode>
                        {'{ data: <body>, _leash: { tx_sig, receipt_hash, explorer, … } }'}
                      </InlineCode>{' '}
                      so callers get the proof inline. Ignored when <strong>Redirect URL</strong> is
                      set.
                    </span>
                  </span>
                </label>

                {error && <p className="text-sm text-danger">{error}</p>}

                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Creating…
                    </>
                  ) : (
                    <>
                      <Plus className="size-4" /> Create payment link
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe2 className="size-4 text-brand" /> Your payment links
                </CardTitle>
                <CardDescription>
                  Live URLs you can share. Each one is a real x402 paywall — probing returns 402 +{' '}
                  <InlineCode>PAYMENT-REQUIRED</InlineCode>; paying triggers a real SPL USDC
                  transfer + earn receipt.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {listError && (
                  <p className="text-sm text-danger">
                    Couldn&apos;t reach the runner: {(listError as Error).message}
                  </p>
                )}
                {!listError && links.length === 0 && (
                  <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                    No payment links yet for this agent.
                  </p>
                )}
                {links.map((ep) => (
                  <PaymentLinkRow
                    key={ep.id}
                    endpoint={ep}
                    origin={origin}
                    onDelete={() => removeLink(ep.id)}
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="size-4 text-brand" /> Receipts feed
                </CardTitle>
                <CardDescription>
                  Every settlement on a link emits an <InlineCode>earn</InlineCode>{' '}
                  <InlineCode>ReceiptV1</InlineCode> back to the runner under{' '}
                  <InlineCode>/a/&lt;agent&gt;/receipts</InlineCode>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {ownerAgent ? (
                  <Link
                    href={`/agents/${ownerAgent}`}
                    className="inline-flex items-center gap-2 text-sm text-brand hover:underline"
                  >
                    <Bot className="size-4" /> Open agent profile · view earn receipts
                    <ExternalLink className="size-3" />
                  </Link>
                ) : (
                  <span className="text-sm text-fg-muted">Pick an agent first.</span>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentLinkRow({
  endpoint,
  origin,
  onDelete,
}: {
  endpoint: EndpointV1;
  origin: string;
  onDelete: () => void;
}) {
  const url = `${origin || ''}/x/${endpoint.id}`;
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    if (typeof navigator === 'undefined') return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="rounded-md border border-border bg-bg-elev/40 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="brand">{endpoint.method}</Badge>
          <code className="font-mono text-xs">{endpoint.id}</code>
          <Badge variant="success">{endpoint.price}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="text-sm">{endpoint.label}</div>
      {endpoint.description && <div className="text-xs text-fg-muted">{endpoint.description}</div>}
      <div className="flex flex-wrap gap-1 text-[10px]">
        {endpoint.wrap_receipt && <Badge variant="outline">embeds receipt</Badge>}
        {endpoint.redirect_url && (
          <Badge variant="outline" title={endpoint.redirect_url}>
            ↳ redirect
          </Badge>
        )}
        {endpoint.webhook_url && (
          <Badge variant="outline" title={endpoint.webhook_url}>
            ⇉ webhook
          </Badge>
        )}
      </div>
      <Separator />
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded border border-border bg-bg px-2 py-1 text-[11px] font-mono">
          {url}
        </code>
        <Button variant="secondary" size="sm" onClick={copy}>
          <Copy className="size-3.5" /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" /> Open
          </a>
        </Button>
      </div>
      <details className="text-[11px] text-fg-subtle">
        <summary className="cursor-pointer hover:text-fg">EndpointV1</summary>
        <div className="pt-2">
          <JsonViewer data={endpoint} maxHeight="14rem" />
        </div>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-sm break-all">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

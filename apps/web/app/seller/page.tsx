'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import {
  Bot,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe2,
  Link as LinkIcon,
  Loader2,
  Plus,
  Receipt,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { EndpointV1, ReceiptV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { InlineCode } from '@/components/ui/code';
import { useToast } from '@/components/ui/toast';
import { Pager, usePagedItems } from '@/components/ui/pager';
import { ReceiptRow } from '@/components/receipt-row';
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
  const toast = useToast();
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
  const [responseBodyJson, setResponseBodyJson] = React.useState('{}');
  const [customId, setCustomId] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [wrapReceipt, setWrapReceipt] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [origin, setOrigin] = React.useState('');

  function resetFormFields() {
    setLabel('');
    setDescription('');
    setMethod('POST');
    setPrice('');
    setResponseBodyJson('{}');
    setCustomId('');
    setWebhookUrl('');
    setWrapReceipt(true);
  }

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
  const linksPaged = usePagedItems(links, 5);
  const lastListError = React.useRef<string | null>(null);

  // Earn-receipt feed for the selected agent. We auto-refresh every 5s so
  // a payment landing in another tab shows up here without a manual reload.
  const receiptsKey = ownerAgent ? `/api/receipts/${ownerAgent}` : null;
  const { data: receiptFeed, error: receiptError } = useSWR<{ receipts: ReceiptV1[] }>(
    receiptsKey,
    fetcher,
    { refreshInterval: 5000 },
  );
  const earnReceipts = React.useMemo(
    () =>
      (receiptFeed?.receipts ?? [])
        .filter((r) => r.kind === 'earn' && r.decision === 'allow' && r.tx_sig)
        // newest first
        .slice()
        .reverse(),
    [receiptFeed],
  );
  const receiptsPaged = usePagedItems(earnReceipts, 5);

  React.useEffect(() => {
    if (!listError) {
      lastListError.current = null;
      return;
    }
    const msg = (listError as Error).message;
    if (lastListError.current === msg) return;
    lastListError.current = msg;
    toast.error('Could not load payment links', msg);
  }, [listError, toast]);

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ownerAgent) {
      const msg = 'Pick an agent to receive payments.';
      setError(msg);
      toast.error('Missing agent', msg);
      return;
    }
    let parsedResponseBody: unknown;
    try {
      parsedResponseBody = responseBodyJson.trim() ? JSON.parse(responseBodyJson) : {};
    } catch (err) {
      const msg = `Response body must be valid JSON: ${(err as Error).message}`;
      setError(msg);
      toast.error('Invalid response body JSON', msg);
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
            body: parsedResponseBody,
          },
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
      resetFormFields();
      await mutate(ownerEndpointsKey);
      toast.success(
        'Payment link created',
        `Your /x/${json.endpoint?.id ?? 'new-link'} endpoint is live.`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error('Failed to create payment link', msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLink(id: string) {
    try {
      const res = await fetch(`${ENDPOINTS_KEY}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`runner returned ${res.status}`);
      await mutate(ownerEndpointsKey);
      toast.success('Payment link deleted', `"${id}" now returns 404.`);
    } catch (err) {
      toast.error('Failed to delete payment link', (err as Error).message);
    }
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

                <Field label="Response body (optional JSON, returned after successful payment)">
                  <Textarea
                    value={responseBodyJson}
                    onChange={(e) => setResponseBodyJson(e.target.value)}
                    rows={4}
                    className="font-mono text-xs"
                    spellCheck={false}
                    placeholder='{"status":"paid"}'
                  />
                  <span className="text-[11px] text-fg-subtle">
                    Leave as <InlineCode>{'{}'}</InlineCode> for an empty response payload.
                  </span>
                </Field>

                <Separator />

                <h3 className="text-xs font-medium uppercase tracking-widest text-fg-subtle">
                  Post-payment hooks (all optional)
                </h3>

                <Field label="Webhook URL (fire-and-forget POST)">
                  <Input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-agent.com/leash-callback"
                    type="url"
                    className="font-mono text-xs"
                  />
                  <span className="text-[11px] text-fg-subtle">
                    After settlement we POST <InlineCode>{'{ payment, response }'}</InlineCode> here
                    in the background. Use it to hand the paid response to a downstream agent /
                    fulfilment service / analytics sink without making the buyer poll. Buyers can
                    add a per-call <InlineCode>x-leash-callback</InlineCode> header to fire one of
                    their own (both will be called).
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
                      so callers get the proof inline.
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
                {linksPaged.pageItems.map((ep) => (
                  <PaymentLinkRow
                    key={ep.id}
                    endpoint={ep}
                    origin={origin}
                    onDelete={() => removeLink(ep.id)}
                  />
                ))}
                <Pager
                  page={linksPaged.page}
                  pageCount={linksPaged.pageCount}
                  onPageChange={linksPaged.setPage}
                  total={linksPaged.total}
                  pageSize={linksPaged.pageSize}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="size-4 text-brand" /> Receipts feed
                </CardTitle>
                <CardDescription>
                  Successful <InlineCode>earn</InlineCode> receipts collected by this agent. Auto-
                  refreshes every 5s. Receipts that did not settle (insufficient balance,
                  facilitator error, etc) are filtered out — open the agent profile to see them.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {!ownerAgent && <span className="text-sm text-fg-muted">Pick an agent first.</span>}
                {ownerAgent && receiptError && (
                  <p className="text-sm text-danger">
                    Couldn&apos;t reach the runner: {(receiptError as Error).message}
                  </p>
                )}
                {ownerAgent && !receiptError && earnReceipts.length === 0 && (
                  <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                    No earn receipts yet — share one of your payment links to collect a payment.
                  </p>
                )}
                {receiptsPaged.pageItems.map((r) => (
                  <ReceiptRow key={r.receipt_hash} receipt={r} />
                ))}
                <Pager
                  page={receiptsPaged.page}
                  pageCount={receiptsPaged.pageCount}
                  onPageChange={receiptsPaged.setPage}
                  total={receiptsPaged.total}
                  pageSize={receiptsPaged.pageSize}
                />
                {ownerAgent && (
                  <Link
                    href={`/agents/${ownerAgent}`}
                    className="inline-flex items-center gap-2 text-xs text-brand hover:underline self-start"
                  >
                    <Bot className="size-3.5" /> Full receipt history · agent profile
                    <ExternalLink className="size-3" />
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact, collapsible payment-link row that mirrors the receipt-feed
 * visual language: chevron + method/price/id summary on a single line,
 * expand to reveal the full URL, share controls, and the raw EndpointV1.
 */
function PaymentLinkRow({
  endpoint,
  origin,
  onDelete,
}: {
  endpoint: EndpointV1;
  origin: string;
  onDelete: () => void;
}) {
  const toast = useToast();
  const url = `${origin || ''}/x/${endpoint.id}`;
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    if (typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Copied payment link', url);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error('Could not copy link', (err as Error).message);
    }
  }
  return (
    <div className="rounded-md border border-border bg-bg-elev/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-bg-elev"
      >
        <ChevronRight
          className={cn('size-4 text-fg-subtle transition-transform', open && 'rotate-90')}
        />
        <Badge variant="brand">{endpoint.method}</Badge>
        <Badge variant="success">{endpoint.price}</Badge>
        <span className="font-mono text-xs text-fg-muted truncate">/x/{endpoint.id}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-fg-subtle">
          <span className="hidden sm:inline truncate max-w-[14rem]" title={endpoint.label}>
            {endpoint.label}
          </span>
          {endpoint.wrap_receipt && (
            <Badge variant="outline" className="hidden sm:inline-flex">
              embeds receipt
            </Badge>
          )}
          {endpoint.webhook_url && (
            <Badge variant="outline" title={endpoint.webhook_url} className="hidden sm:inline-flex">
              ⇉ webhook
            </Badge>
          )}
          <span
            role="button"
            aria-label="Delete payment link"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-fg-subtle hover:bg-bg hover:text-danger"
          >
            <Trash2 className="size-3.5" />
          </span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-border p-3 flex flex-col gap-2">
          {endpoint.description && (
            <div className="text-xs text-fg-muted">{endpoint.description}</div>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded border border-border bg-bg px-2 py-1 text-[11px] font-mono">
              {url}
            </code>
            <Button variant="secondary" size="sm" onClick={copy}>
              <Copy className="size-3.5" /> {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
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
      ) : null}
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

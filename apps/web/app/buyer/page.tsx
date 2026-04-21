'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Bot,
  ExternalLink,
  Globe2,
  Plus,
  Receipt,
  Send,
  Shield,
  ShieldOff,
  Trash2,
  Wallet,
} from 'lucide-react';
import { createBuyer, type BuyerCallResult } from '@leash/buyer-kit';
import type { EndpointV1, ReceiptV1, RulesV1 } from '@leash/schemas';
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
import { usePrivySvmSigner } from '@/lib/privy-svm-signer';
import { transactionExplorerUrl } from '@/lib/solscan';
import { SOLANA_RPC } from '@/lib/env';
import { WalletBalanceBadge } from '@/components/wallet-balance-badge';
import {
  effectiveRules,
  isLimitless,
  LIMITLESS_RULES,
  listAgents,
  loadAgent,
  type StoredAgent,
} from '@/lib/agent-storage';

type FireResult =
  | {
      ok: true;
      receipt: ReceiptV1;
      quotedPrice?: ReceiptV1['price'];
      failureReason?: string;
      response: {
        status: number;
        body: unknown;
        leash: {
          tx_sig: string | null;
          receipt_hash: string | null;
          agent: string | null;
          tx_explorer: string | null;
          agent_explorer: string | null;
          redirected_to: string | null;
        };
      };
    }
  | { ok: false; error: string };

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

/**
 * Render a `ReceiptV1['price']` (raw on-chain units, USDC = 6 decimals) as a
 * human-friendly string like `5 USDC`. Returns `null` if the price isn't
 * known yet so callers can branch on display.
 */
function formatPrice(price: ReceiptV1['price'] | undefined): string | null {
  if (!price) return null;
  const decimals = price.currency === 'USDC' ? 6 : 0;
  if (decimals === 0) return `${price.amount} ${price.currency}`;
  // Cheap fixed-point divide so we don't pull in BigInt math just for display.
  const padded = price.amount.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return `${frac ? `${whole}.${frac}` : whole} ${price.currency}`;
}

/**
 * Autonomous-agent cockpit.
 *
 * The user picks one of their agents (the "operator"). The Privy embedded
 * wallet acts as that agent's registered Executive (per Metaplex's Run an
 * Agent docs) and signs every x402 SPL transfer on the agent's behalf.
 * Behaviour rules captured at agent creation are enforced before each
 * call by `@leash/buyer-kit`'s policy gate.
 */
export default function BuyerPage() {
  const toast = useToast();
  const { signer, wallet, ready } = usePrivySvmSigner();

  const [agents, setAgents] = React.useState<
    Array<Pick<StoredAgent, 'mint' | 'label' | 'network'>>
  >([]);
  const [selectedAgent, setSelectedAgent] = React.useState<string>('');
  const [agentRecord, setAgentRecord] = React.useState<StoredAgent | null>(null);

  const [url, setUrl] = React.useState('/x/');
  const [method, setMethod] = React.useState<'GET' | 'POST'>('POST');
  const [body, setBody] = React.useState('{}');
  const [callbackUrl, setCallbackUrl] = React.useState('');

  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<FireResult | null>(null);
  const [history, setHistory] = React.useState<ReceiptV1[]>([]);

  React.useEffect(() => {
    const a = listAgents();
    setAgents(a);
    if (a[0]?.mint && !selectedAgent) setSelectedAgent(a[0].mint);
  }, [selectedAgent]);

  React.useEffect(() => {
    if (!selectedAgent) return;
    setAgentRecord(loadAgent(selectedAgent));
  }, [selectedAgent]);

  const { data: linksData } = useSWR<{ endpoints: EndpointV1[] }>(`/api/endpoints`, fetcher, {
    refreshInterval: 8000,
  });
  const allLinks = linksData?.endpoints ?? [];

  const rules: RulesV1 = React.useMemo(() => {
    if (agentRecord?.rules) return agentRecord.rules;
    if (agentRecord?.rules === null) return LIMITLESS_RULES;
    return selectedAgent ? effectiveRules(selectedAgent) : LIMITLESS_RULES;
  }, [agentRecord, selectedAgent]);
  const isLimitlessAgent = isLimitless(agentRecord?.rules ?? null);
  const rulesCardData = isLimitlessAgent ? {} : rules;

  async function shipReceipt(receipt: ReceiptV1): Promise<void> {
    try {
      await fetch(`/api/receipts/${encodeURIComponent(receipt.agent)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(receipt),
      });
    } catch {
      /* runner outage is silent on this side */
    }
  }

  async function fire() {
    if (!signer) {
      const msg = 'Connect a Solana wallet first.';
      setResult({ ok: false, error: msg });
      toast.error('Wallet required', msg);
      return;
    }
    if (!selectedAgent) {
      const msg = 'Pick an agent first.';
      setResult({ ok: false, error: msg });
      toast.error('Agent required', msg);
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const target = new URL(url, window.location.origin).toString();
      const buyer = createBuyer({
        agent: selectedAgent,
        rules,
        signer,
        networks: ['solana-devnet'],
        rpcUrl: SOLANA_RPC,
        onReceipt: shipReceipt,
      });
      const headers: Record<string, string> = {};
      if (method === 'POST' && body) headers['content-type'] = 'application/json';
      if (callbackUrl.trim()) headers['x-leash-callback'] = callbackUrl.trim();
      const init: RequestInit = { method, redirect: 'manual' };
      if (Object.keys(headers).length > 0) init.headers = headers;
      if (method === 'POST' && body) init.body = body;
      const callResult: BuyerCallResult = await buyer.fetch(target, init);
      const text = await callResult.response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      const h = callResult.response.headers;
      setResult({
        ok: true,
        receipt: callResult.receipt,
        quotedPrice: callResult.quotedPrice,
        failureReason: callResult.failureReason,
        response: {
          status: callResult.response.status,
          body: parsed,
          leash: {
            tx_sig: h.get('x-leash-tx-sig') || null,
            receipt_hash: h.get('x-leash-receipt-hash') || null,
            agent: h.get('x-leash-agent') || null,
            tx_explorer: h.get('x-leash-tx-explorer') || null,
            agent_explorer: h.get('x-leash-agent-explorer') || null,
            redirected_to: callResult.response.status === 303 ? h.get('location') : null,
          },
        },
      });
      setHistory((h) => [callResult.receipt, ...h].slice(0, 25));
      const settled = !!callResult.receipt.tx_sig;
      if (callResult.response.status === 402 && !settled) {
        const quoted = formatPrice(callResult.quotedPrice);
        const reason = callResult.failureReason ?? 'no failure reason returned by the seller';
        toast.error(`Settlement failed${quoted ? ` (asked ${quoted})` : ''}`, reason);
      } else if (settled) {
        toast.success(
          'x402 call completed',
          `Status ${callResult.response.status} · receipt ${callResult.receipt.receipt_hash.slice(0, 12)}…`,
        );
      } else {
        toast.info(
          'Call completed (no settlement)',
          `Status ${callResult.response.status} — no PAYMENT-RESPONSE header, no tx_sig.`,
        );
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'buyer.fetch failed';
      setResult({ ok: false, error: msg });
      toast.error('x402 call failed', msg);
    } finally {
      setLoading(false);
    }
  }

  const owner = wallet?.address;
  const ownerShort = owner ? `${owner.slice(0, 4)}…${owner.slice(-4)}` : null;
  const agentShort = selectedAgent
    ? `${selectedAgent.slice(0, 4)}…${selectedAgent.slice(-4)}`
    : null;

  function handleUrlChange(nextUrl: string) {
    setUrl(nextUrl);
    // If users paste a link with request body params, auto-fill the body box.
    // Supported keys: ?body=... or ?request_body=...
    if (typeof window === 'undefined') return;
    try {
      const parsed = new URL(nextUrl, window.location.origin);
      const raw =
        parsed.searchParams.get('body') ??
        parsed.searchParams.get('request_body') ??
        parsed.searchParams.get('requestBody');
      if (!raw) return;
      try {
        const asJson = JSON.parse(raw) as unknown;
        setBody(JSON.stringify(asJson, null, 2));
      } catch {
        setBody(raw);
      }
    } catch {
      /* ignore invalid transient URL input while user is typing */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/buyer-kit"
        title="Autonomous-agent cockpit"
        description="Pick one of your agents, point it at any x402 URL on the open internet, and your Privy wallet will sign on its behalf as the registered Executive. Behaviour rules captured at agent creation gate every call."
      />

      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <Wallet className="size-4 text-warning" />
          {!ready && <span>Loading Privy…</span>}
          {ready && !wallet && (
            <span>
              Connect a Solana wallet (top-right) to enable real x402 calls. Until then the page is
              read-only.
            </span>
          )}
          {ready && wallet && (
            <div className="flex flex-col gap-2 w-full">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  Executive <span className="font-mono text-fg">{ownerShort}</span> signing on
                  behalf of agent{' '}
                  {agentShort ? (
                    <span className="font-mono text-fg">{agentShort}</span>
                  ) : (
                    <em>(none selected)</em>
                  )}
                  .
                </span>
                <Badge variant="brand">solana-devnet</Badge>
                <Badge variant="success">facilitator.svmacc.tech</Badge>
              </div>
              <WalletBalanceBadge owner={owner} label="Executive (Privy)" />
              <span className="text-[11px] text-fg-subtle">
                Per Metaplex&apos;s{' '}
                <a
                  href="https://www.metaplex.com/docs/agents/run-an-agent"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Run an Agent
                </a>{' '}
                docs, your wallet is registered as the agent&apos;s Executive and authorised via an
                on-chain delegation record. No private keys ever leave the browser.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {agents.length === 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col gap-3 py-4">
            <p className="text-sm">You don&apos;t have any agents on this device yet.</p>
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
              <CardTitle>Fire an x402 request</CardTitle>
              <CardDescription>
                Defaults to the in-app payment-link surface (<InlineCode>/x/&lt;id&gt;</InlineCode>
                ), but you can paste any x402 URL the agent has budget for.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label="Agent (operator)">
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm"
                >
                  {agents.map((a) => (
                    <option key={a.mint} value={a.mint}>
                      {a.label ?? `${a.mint.slice(0, 4)}…${a.mint.slice(-4)}`} · {a.network}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="URL">
                <Input
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  className="font-mono"
                  placeholder="/x/<id> or https://example.com/x402-route"
                />
              </Field>

              <Field label="Method">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
                  className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm w-32"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </Field>

              {method === 'POST' && (
                <Field label="Body">
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="{}"
                  />
                </Field>
              )}

              <Field label="Forward response to (optional)">
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  type="url"
                  className="font-mono text-xs"
                  placeholder="https://your-agent.com/leash-callback"
                />
                <span className="text-[11px] text-fg-subtle">
                  Sent as <InlineCode>x-leash-callback</InlineCode>. After settlement the seller
                  fires <InlineCode>{'{ payment, response }'}</InlineCode> to this URL — useful for
                  chaining one agent&rsquo;s output into another.
                </span>
              </Field>

              {allLinks.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label>Quick-pick saved payment links</Label>
                  <div className="flex flex-wrap gap-1">
                    {allLinks.slice(0, 8).map((ep) => (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => {
                          setUrl(`/x/${ep.id}`);
                          setMethod(ep.method);
                        }}
                        className="text-[11px] rounded border border-border bg-bg-elev px-2 py-0.5 hover:border-border-strong text-fg-muted hover:text-fg"
                        title={`${ep.method} /x/${ep.id} · ${ep.price}`}
                      >
                        {ep.label} · {ep.price}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="flex items-center gap-2">
                {isLimitlessAgent ? (
                  <Badge variant="outline" className="gap-1">
                    <ShieldOff className="size-3" /> limitless
                  </Badge>
                ) : (
                  <Badge variant="brand" className="gap-1">
                    <Shield className="size-3" /> rules enforced
                  </Badge>
                )}
                <span className="text-[11px] text-fg-muted">
                  Rules are read from this agent&apos;s record (set at creation).{' '}
                  {selectedAgent && (
                    <Link href={`/agents/${selectedAgent}`} className="underline hover:text-fg">
                      Edit on profile →
                    </Link>
                  )}
                </span>
              </div>

              <Button onClick={fire} disabled={loading || !signer || !selectedAgent} size="lg">
                <Send /> {loading ? 'Signing & paying…' : 'Fire request'}
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="size-4 text-brand" /> Active RulesV1
                </CardTitle>
                <CardDescription>
                  Effective rules for the selected agent (limitless agents get a wide-open allow-all
                  preset).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JsonViewer data={rulesCardData} maxHeight="14rem" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Latest result</CardTitle>
                <CardDescription>
                  Browser-side <InlineCode>createBuyer().fetch(url)</InlineCode>. Privy signs the
                  SPL transfer; <InlineCode>facilitator.svmacc.tech</InlineCode> settles.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {!result && (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                    Fire a request to see a receipt.
                  </div>
                )}
                {result && !result.ok && <p className="text-sm text-danger">{result.error}</p>}
                {result && result.ok && <ResultPanel result={result} />}
              </CardContent>
            </Card>

            {history.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Session history
                    <Button variant="ghost" size="sm" onClick={() => setHistory([])}>
                      <Trash2 className="size-3.5" /> Clear
                    </Button>
                  </CardTitle>
                  <CardDescription>
                    Receipts from this browser session, also shipped to the runner via{' '}
                    <InlineCode>onReceipt</InlineCode>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {history.map((r) => (
                    <div
                      key={r.receipt_hash}
                      className="flex items-center gap-2 text-xs font-mono text-fg-muted"
                    >
                      <Badge variant={r.decision === 'allow' ? 'success' : 'danger'}>
                        {r.decision}
                      </Badge>
                      <span className="truncate">
                        {r.request.method} {r.request.url}
                      </span>
                      {r.tx_sig && r.price?.network && (
                        <a
                          href={transactionExplorerUrl(r.price.network, r.tx_sig)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand hover:underline"
                        >
                          {r.tx_sig.slice(0, 6)}…
                        </a>
                      )}
                      <span className="ml-auto text-fg-subtle">#{r.nonce}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {allLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe2 className="size-4 text-brand" /> All discoverable payment links
            </CardTitle>
            <CardDescription>
              Every payment link the runner knows about. Pick one above to load it into the
              firing-line.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {allLinks.map((ep) => (
              <Link
                key={ep.id}
                href={`/x/${ep.id}`}
                target="_blank"
                className="rounded border border-border bg-bg-elev px-2 py-1 text-xs hover:border-border-strong"
              >
                <Badge variant="brand" className="mr-1">
                  {ep.method}
                </Badge>
                <span className="font-mono">/x/{ep.id}</span> · {ep.price}{' '}
                <ExternalLink className="size-3 inline" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: Extract<FireResult, { ok: true }> }) {
  const leash = result.response.leash;
  const settled = !!result.receipt.tx_sig;
  const settlementFailed = result.response.status === 402 && !settled;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Response status:{' '}
        <Badge variant={result.response.status < 400 ? 'success' : 'warning'}>
          {result.response.status}
        </Badge>
        <Badge variant={result.receipt.decision === 'allow' ? 'brand' : 'danger'}>
          {result.receipt.decision}
        </Badge>
        <Badge variant={settled ? 'success' : 'outline'} className="gap-1">
          <Receipt className="size-3" />
          {settled ? 'settled on-chain' : 'no settlement'}
        </Badge>
        {leash.redirected_to && (
          <Badge variant="outline" className="gap-1" title={leash.redirected_to}>
            ↳ redirected
          </Badge>
        )}
      </div>
      {settlementFailed && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-fg-subtle">
          <p className="text-sm text-fg">Seller returned 402 — payment did not settle.</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-fg-muted">Seller demanded</dt>
            <dd className="text-fg">
              {formatPrice(result.quotedPrice) ?? <span className="text-fg-muted">unknown</span>}
            </dd>
            <dt className="text-fg-muted">Reason</dt>
            <dd className="text-fg">
              {result.failureReason ?? (
                <span className="text-fg-muted">
                  not reported by the seller (check Response body below)
                </span>
              )}
            </dd>
          </dl>
          <p className="mt-2">Most common fixes:</p>
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>
              Mint devnet USDC (
              <InlineCode>4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU</InlineCode>) to the
              connected Privy wallet from{' '}
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                faucet.circle.com
              </a>
              .
            </li>
            <li>
              Top up a tiny bit of devnet SOL for ATA rent via{' '}
              <a
                href="https://faucet.solana.com"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                faucet.solana.com
              </a>
              .
            </li>
          </ul>
        </div>
      )}
      {result.receipt.tx_sig && result.receipt.price?.network && (
        <a
          href={transactionExplorerUrl(result.receipt.price.network, result.receipt.tx_sig)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit font-mono"
        >
          <ExternalLink className="size-3" />
          Inspect tx {result.receipt.tx_sig.slice(0, 8)}… on Solscan
        </a>
      )}
      {leash.redirected_to && (
        <a
          href={leash.redirected_to}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit font-mono"
          title={leash.redirected_to}
        >
          <ExternalLink className="size-3" /> Follow seller redirect →
        </a>
      )}
      <Link
        href={`/agents/${encodeURIComponent(result.receipt.agent)}`}
        className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit"
      >
        <Bot className="size-3" /> View receipts for this agent
      </Link>
      <div>
        <Label className="mb-1 block">Leash response headers (X-Leash-*)</Label>
        <JsonViewer data={leash} maxHeight="10rem" />
      </div>
      <div>
        <Label className="mb-1 block">Receipt</Label>
        <JsonViewer data={result.receipt} maxHeight="22rem" />
      </div>
      <div>
        <Label className="mb-1 block">Response body</Label>
        <JsonViewer data={result.response.body} maxHeight="14rem" />
      </div>
    </>
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

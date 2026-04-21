'use client';

import * as React from 'react';
import Link from 'next/link';
import { Send, Trash2, ExternalLink, Receipt, Wallet } from 'lucide-react';
import { createBuyer, type BuyerCallResult } from '@leash/buyer-kit';
import type { ReceiptV1, RulesV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { InlineCode } from '@/components/ui/code';
import { usePrivySvmSigner } from '@/lib/privy-svm-signer';
import { transactionExplorerUrl } from '@/lib/solscan';
import { SOLANA_RPC } from '@/lib/env';
import { WalletBalanceBadge } from '@/components/wallet-balance-badge';

type FireResult =
  | { ok: true; receipt: ReceiptV1; response: { status: number; body: unknown } }
  | { ok: false; error: string };

const DEFAULT_AGENT = '11111111111111111111111111111111';

/**
 * Browser-side x402 buyer playground.
 *
 * The flow now mirrors the SDK exactly:
 *   1. The Privy embedded wallet is exposed as a `@solana/kit`
 *      `TransactionPartialSigner` via `usePrivySvmSigner`.
 *   2. `createBuyer({ signer, ... })` is constructed in the browser; its
 *      internal `paidFetch` is the real `@x402/fetch` + `ExactSvmScheme`
 *      pair pointed at devnet.
 *   3. A `Fire` click invokes `buyer.fetch(url)`. On 402, x402 builds the
 *      USDC SPL transfer, hands it to Privy to sign, posts it through to
 *      the seller, and we get a 200 with a real `tx_sig` plus a chained
 *      spend `ReceiptV1`.
 *   4. The receipt is shipped to the runner via `/api/receipts/:mint`
 *      (CORS-safe proxy) so the explorer feed updates in real time.
 */
export default function BuyerPage() {
  const { signer, wallet, ready } = usePrivySvmSigner();

  const [agent, setAgent] = React.useState(DEFAULT_AGENT);
  const [url, setUrl] = React.useState('/api/seller/echo');
  const [method, setMethod] = React.useState<'GET' | 'POST'>('POST');
  const [body, setBody] = React.useState('{"hello":"leash"}');
  const [perCall, setPerCall] = React.useState('0.01');
  const [daily, setDaily] = React.useState('1.00');
  const [hostsRaw, setHostsRaw] = React.useState('localhost,127.0.0.1');
  const [intervalSeconds, setIntervalSeconds] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<FireResult | null>(null);
  const [history, setHistory] = React.useState<ReceiptV1[]>([]);

  const rules: RulesV1 = React.useMemo(
    () => ({
      v: '0.1',
      budget: { daily, perCall, currency: 'USDC' },
      hosts: {
        allow: hostsRaw
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
      },
      triggers: [{ type: 'interval', seconds: intervalSeconds }],
    }),
    [daily, perCall, hostsRaw, intervalSeconds],
  );

  async function shipReceipt(receipt: ReceiptV1): Promise<void> {
    try {
      await fetch(`/api/receipts/${encodeURIComponent(receipt.agent)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(receipt),
      });
    } catch {
      /* swallow — runner outage must not surface as a buyer-side error */
    }
  }

  async function fire() {
    if (!signer) {
      setResult({ ok: false, error: 'Connect a Solana wallet first.' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      // Resolve relative URLs and force the seller to attribute its earn
      // receipt to the same agent the buyer is spending from, so the
      // explorer shows both sides.
      const u = new URL(url, window.location.origin);
      if (u.pathname === '/api/seller/echo' && !u.searchParams.has('asset')) {
        u.searchParams.set('asset', agent);
      }
      const targetUrl = u.toString();

      const buyer = createBuyer({
        agent,
        rules,
        signer,
        networks: ['solana-devnet'],
        rpcUrl: SOLANA_RPC,
        onReceipt: shipReceipt,
      });

      const init: RequestInit = { method };
      if (method === 'POST' && body) {
        init.body = body;
        init.headers = { 'content-type': 'application/json' };
      }
      const callResult: BuyerCallResult = await buyer.fetch(targetUrl, init);

      let parsedBody: unknown = null;
      const text = await callResult.response.text();
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
      }
      setResult({
        ok: true,
        receipt: callResult.receipt,
        response: { status: callResult.response.status, body: parsedBody },
      });
      setHistory((h) => [callResult.receipt, ...h].slice(0, 25));
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message ?? 'buyer.fetch failed' });
    } finally {
      setLoading(false);
    }
  }

  const owner = wallet?.address;
  const ownerShort = owner ? `${owner.slice(0, 4)}…${owner.slice(-4)}` : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/buyer-kit"
        title="Buyer playground"
        description="Build a `RulesV1` policy, fire a real x402 SPL-USDC payment from your Privy wallet, and watch the spend receipt land in the explorer."
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
                  Owner signer <span className="font-mono text-fg">{ownerShort}</span> will sign on
                  behalf of agent{' '}
                  <span className="font-mono text-fg">
                    {agent.slice(0, 4)}…{agent.slice(-4)}
                  </span>
                  .
                </span>
                <Badge variant="brand">solana-devnet</Badge>
                <Badge variant="success">facilitator.svmacc.tech</Badge>
              </div>
              <WalletBalanceBadge owner={owner} label="Owner" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>
              Default targets the built-in <InlineCode>/api/seller/echo</InlineCode> seller — a real{' '}
              <InlineCode>@leash/seller-kit</InlineCode> middleware that gates with x402 on devnet
              USDC.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Agent (Core asset mint)">
              <Input
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field label="URL">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
                  className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </Field>
              <Field label="Per-call ceiling (USDC)">
                <Input
                  value={perCall}
                  onChange={(e) => setPerCall(e.target.value)}
                  className="font-mono"
                />
              </Field>
            </div>
            {method === 'POST' && (
              <Field label="Body">
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
            )}

            <Separator />

            <h3 className="text-xs font-medium uppercase tracking-widest text-fg-subtle">
              RulesV1
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily budget (USDC)">
                <Input
                  value={daily}
                  onChange={(e) => setDaily(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label="Trigger interval (sec)">
                <Input
                  type="number"
                  value={intervalSeconds}
                  min={1}
                  onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                />
              </Field>
            </div>
            <Field label="Allowed hosts (comma-separated)">
              <Input value={hostsRaw} onChange={(e) => setHostsRaw(e.target.value)} />
            </Field>

            <Button onClick={fire} disabled={loading || !signer} size="lg">
              <Send /> {loading ? 'Signing & paying…' : 'Fire request'}
            </Button>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>RulesV1 (live preview)</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonViewer data={rules} maxHeight="14rem" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest result</CardTitle>
              <CardDescription>
                In the browser we run{' '}
                <InlineCode>createBuyer({'{ agent, rules, signer }'}).fetch(url)</InlineCode>. The
                Privy wallet signs the SPL transfer; the seller settles via{' '}
                <InlineCode>facilitator.svmacc.tech</InlineCode>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!result && (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                  Fire a request to see a receipt.
                </div>
              )}
              {result && !result.ok && <p className="text-sm text-danger">{result.error}</p>}
              {result && result.ok && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    Response status:{' '}
                    <Badge variant={result.response.status < 400 ? 'success' : 'warning'}>
                      {result.response.status}
                    </Badge>
                    <Badge variant={result.receipt.decision === 'allow' ? 'brand' : 'danger'}>
                      {result.receipt.decision}
                    </Badge>
                    <Badge variant="success" className="gap-1">
                      <Receipt className="size-3" /> spend receipt shipped
                    </Badge>
                  </div>
                  {result.receipt.tx_sig && result.receipt.price?.network && (
                    <a
                      href={transactionExplorerUrl(
                        result.receipt.price.network,
                        result.receipt.tx_sig,
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit font-mono"
                    >
                      <ExternalLink className="size-3" />
                      Inspect tx {result.receipt.tx_sig.slice(0, 8)}… on Solscan
                    </a>
                  )}
                  {result.receipt.kind === 'spend' && result.receipt.price && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border bg-bg-elev/40 px-3 py-2 text-[11px] font-mono">
                      <SettlementCell label="Amount">
                        {result.receipt.price.amount} {result.receipt.price.currency}
                      </SettlementCell>
                      {result.receipt.price.network && (
                        <SettlementCell label="Network">
                          {result.receipt.price.network}
                        </SettlementCell>
                      )}
                      {result.receipt.price.asset && (
                        <SettlementCell label="Asset">
                          {result.receipt.price.asset.slice(0, 6)}…
                          {result.receipt.price.asset.slice(-4)}
                        </SettlementCell>
                      )}
                      {result.receipt.facilitator && (
                        <SettlementCell label="Facilitator">
                          {String(result.receipt.facilitator)}
                        </SettlementCell>
                      )}
                      {result.receipt.payment_requirements_hash && (
                        <SettlementCell label="Reqs hash" colSpan>
                          {result.receipt.payment_requirements_hash.slice(0, 12)}…
                        </SettlementCell>
                      )}
                    </div>
                  )}
                  <Link
                    href={`/agents/${encodeURIComponent(result.receipt.agent)}`}
                    className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit"
                  >
                    <ExternalLink className="size-3" /> View receipts for{' '}
                    <span className="font-mono">
                      {result.receipt.agent.slice(0, 4)}…{result.receipt.agent.slice(-4)}
                    </span>{' '}
                    in the explorer
                  </Link>
                  <div>
                    <Label className="mb-1 block">Receipt</Label>
                    <JsonViewer data={result.receipt} maxHeight="22rem" />
                  </div>
                  <div>
                    <Label className="mb-1 block">Response body</Label>
                    <JsonViewer data={result.response.body} maxHeight="14rem" />
                  </div>
                </>
              )}
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
                  Receipts from this browser session. Each one was also shipped to the runner via
                  <InlineCode>onReceipt</InlineCode> (so the explorer feed for the agent fills in
                  real time).
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

function SettlementCell({
  label,
  children,
  colSpan,
}: {
  label: string;
  children: React.ReactNode;
  colSpan?: boolean;
}) {
  return (
    <div className={colSpan ? 'col-span-2' : undefined}>
      <span className="text-fg-subtle">{label}: </span>
      <span className="text-fg">{children}</span>
    </div>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { Send, ShoppingBag, ExternalLink, Receipt, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { InlineCode } from '@/components/ui/code';

type SellerCall = {
  status: number;
  body: unknown;
  asset: string;
  ts: string;
  accepts?: unknown[];
  paymentRequired?: string | null;
};

type SavedAgent = { mint: string; label?: string };
const SAVED_AGENTS_KEY = 'leash:web:agents';
const PLACEHOLDER_ASSET = '11111111111111111111111111111111';

function loadSavedAgents(): SavedAgent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_AGENTS_KEY);
    return raw ? (JSON.parse(raw) as SavedAgent[]) : [];
  } catch {
    return [];
  }
}

export default function SellerPage() {
  const [body, setBody] = React.useState('{"hello":"leash"}');
  const [asset, setAsset] = React.useState<string>(PLACEHOLDER_ASSET);
  const [savedAgents, setSavedAgents] = React.useState<SavedAgent[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<SellerCall | null>(null);
  const [history, setHistory] = React.useState<SellerCall[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const agents = loadSavedAgents();
    setSavedAgents(agents);
    if (agents[0]?.mint) setAsset(agents[0].mint);
  }, []);

  /**
   * Probe the seller without paying. The real x402 middleware returns 402
   * + a base64-encoded `PAYMENT-REQUIRED` header carrying the `accepts[]`
   * a buyer would have to satisfy. We decode it so devs can inspect the
   * exact USDC mint, payTo PDA, and amount before firing the buyer.
   */
  async function probe() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const url = `/api/seller/echo?asset=${encodeURIComponent(asset.trim() || PLACEHOLDER_ASSET)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      const required = res.headers.get('PAYMENT-REQUIRED');
      let accepts: unknown[] | undefined;
      if (required) {
        try {
          const decoded = JSON.parse(atob(required)) as { accepts?: unknown[] };
          accepts = decoded.accepts;
        } catch {
          /* leave undefined */
        }
      }
      const call: SellerCall = {
        status: res.status,
        body: parsed,
        asset: asset.trim() || PLACEHOLDER_ASSET,
        ts: new Date().toISOString(),
        accepts,
        paymentRequired: required,
      };
      setResult(call);
      setHistory((h) => [call, ...h].slice(0, 25));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const isPlaceholder = asset.trim() === PLACEHOLDER_ASSET;
  const explorerHref = `/agents/${encodeURIComponent(asset.trim() || PLACEHOLDER_ASSET)}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/seller-kit"
        title="Seller playground"
        description="Hits the built-in echo seller wired with the real `createSeller` from `@leash/seller-kit`. The middleware is real x402 on Solana devnet — `PAYMENT-REQUIRED` 402 unless a fully-signed SPL transfer accompanies the request. Use this page to inspect the offer; use the Buyer playground to actually settle it."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <InfoCard label="Route" value="POST /api/seller/echo" />
        <InfoCard label="Network" value="solana-devnet" />
        <InfoCard label="Facilitator" value="facilitator.svmacc.tech" />
        <InfoCard label="Header required" value="PAYMENT-SIGNATURE" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-brand" /> Probe the seller
          </CardTitle>
          <CardDescription>
            Sending without a payment header returns <InlineCode>402 Payment Required</InlineCode>{' '}
            with a base64 <InlineCode>PAYMENT-REQUIRED</InlineCode> header that lists the seller's{' '}
            <InlineCode>accepts[]</InlineCode> (asset mint, payTo PDA, amount, facilitator fee
            payer). To actually settle, fire from the{' '}
            <Link href="/buyer" className="text-brand underline">
              Buyer playground
            </Link>{' '}
            so your Privy wallet signs the SPL transfer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset">Seller agent (Core asset mint)</Label>
            <div className="flex flex-col gap-1">
              <Input
                id="asset"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="font-mono"
                placeholder={PLACEHOLDER_ASSET}
                spellCheck={false}
              />
              {savedAgents.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {savedAgents.slice(0, 6).map((a) => (
                    <button
                      key={a.mint}
                      type="button"
                      onClick={() => setAsset(a.mint)}
                      className="text-[11px] rounded border border-border bg-bg-elev px-2 py-0.5 hover:border-border-strong text-fg-muted hover:text-fg"
                      title={a.mint}
                    >
                      {a.label ?? `${a.mint.slice(0, 4)}…${a.mint.slice(-4)}`}
                    </button>
                  ))}
                </div>
              )}
              {isPlaceholder && (
                <p className="text-[11px] text-warning">
                  Using the placeholder mint. Pick or paste a real agent so receipts attribute
                  correctly.{' '}
                  <Link href="/agents/new" className="underline">
                    Create one →
                  </Link>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="body">Request body (JSON)</Label>
            <Textarea
              id="body"
              value={body}
              spellCheck={false}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={probe} disabled={loading}>
              <Send /> {loading ? 'Probing…' : 'Probe (no payment)'}
            </Button>
            <Link
              href="/buyer"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-elev px-3 h-9 text-xs hover:border-border-strong"
            >
              Settle from Buyer playground →
            </Link>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {result && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Status:{' '}
                <Badge
                  variant={
                    result.status === 402 ? 'brand' : result.status < 400 ? 'success' : 'warning'
                  }
                >
                  {result.status}
                </Badge>
                {result.status === 402 && <Badge variant="default">payment required</Badge>}
                {result.status === 200 && (
                  <Badge variant="success" className="gap-1">
                    <Receipt className="size-3" /> earn receipt emitted
                  </Badge>
                )}
              </div>

              <Link
                href={explorerHref}
                className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit"
              >
                <ExternalLink className="size-3" /> View receipts for{' '}
                <span className="font-mono">
                  {result.asset.slice(0, 4)}…{result.asset.slice(-4)}
                </span>{' '}
                in the explorer
              </Link>

              {result.accepts && result.accepts.length > 0 && (
                <div>
                  <Label className="mb-1 block">Decoded accepts[] (offer)</Label>
                  <JsonViewer data={result.accepts} />
                </div>
              )}

              <div>
                <Label className="mb-1 block">Response body</Label>
                <JsonViewer data={result.body} />
              </div>
            </div>
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
              Calls fired this session. Receipts are appended to the runner's in-memory store under{' '}
              <InlineCode>/a/&#123;asset&#125;/receipts</InlineCode>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {history.map((c, i) => (
              <div
                key={`${c.ts}-${i}`}
                className="flex items-center gap-2 text-xs font-mono text-fg-muted"
              >
                <Badge
                  variant={c.status === 402 ? 'brand' : c.status < 400 ? 'success' : 'warning'}
                >
                  {c.status}
                </Badge>
                <span className="truncate">
                  probe → {c.asset.slice(0, 4)}…{c.asset.slice(-4)}
                </span>
                <span className="ml-auto text-fg-subtle">
                  {new Date(c.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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

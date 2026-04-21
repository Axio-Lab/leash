'use client';

import * as React from 'react';
import { Send, Trash2 } from 'lucide-react';
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

type FireResult =
  | { ok: true; receipt: ReceiptV1; response: { status: number; body: unknown } }
  | { ok: false; error: string };

const DEFAULT_AGENT = '11111111111111111111111111111111';

export default function BuyerPage() {
  const [agent, setAgent] = React.useState(DEFAULT_AGENT);
  const [url, setUrl] = React.useState('http://localhost:3000/api/seller/echo');
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

  async function fire() {
    setLoading(true);
    setResult(null);
    try {
      // When firing at the built-in seller, attribute the seller's earn
      // receipt to the same agent the user is exploring so /agents/[mint]
      // shows both spend + earn sides of the trade.
      let targetUrl = url;
      try {
        const u = new URL(url, window.location.origin);
        if (u.pathname === '/api/seller/echo' && !u.searchParams.has('asset')) {
          u.searchParams.set('asset', agent);
          targetUrl = u.toString();
        }
      } catch {
        /* invalid URL — let the server reject it */
      }

      const res = await fetch('/api/buyer/fire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent,
          rules,
          url: targetUrl,
          method,
          body: method === 'POST' ? body : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult({ ok: false, error: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setResult({ ok: true, ...json });
      if (json.receipt) {
        setHistory((h) => [json.receipt as ReceiptV1, ...h].slice(0, 25));
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/buyer-kit"
        title="Buyer playground"
        description="Build a `RulesV1` policy, fire a request through `createBuyer().fetch`, and see the receipt the policy engine produces."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>
              Default targets the built-in <InlineCode>/api/seller/echo</InlineCode> seller, so this
              round-trips end-to-end with no other process.
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

            <Button onClick={fire} disabled={loading} size="lg">
              <Send /> {loading ? 'Firing…' : 'Fire request'}
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
                Server runs <InlineCode>createBuyer({'{ agent, rules }'}).fetch(url)</InlineCode>{' '}
                and returns the response + the signed receipt.
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
                  <div className="flex items-center gap-2 text-sm">
                    Response status:{' '}
                    <Badge variant={result.response.status < 400 ? 'success' : 'warning'}>
                      {result.response.status}
                    </Badge>
                    <Badge variant={result.receipt.decision === 'allow' ? 'brand' : 'danger'}>
                      {result.receipt.decision}
                    </Badge>
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
                  Receipts from this browser session (not persisted to the runner; that's configured
                  separately).
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

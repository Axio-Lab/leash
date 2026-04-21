'use client';

import * as React from 'react';
import { Send, ShoppingBag, Lock, Unlock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { InlineCode } from '@/components/ui/code';

type SellerResult = {
  status: number;
  body: unknown;
  withPayment: boolean;
};

export default function SellerPage() {
  const [body, setBody] = React.useState('{"hello":"leash"}');
  const [withPayment, setWithPayment] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<SellerResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function fire() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (withPayment) headers['x-payment'] = 'mock';
      const res = await fetch('/api/seller/echo', {
        method: 'POST',
        headers,
        body,
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      setResult({ status: res.status, body: parsed, withPayment });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/seller-kit"
        title="Seller playground"
        description="A built-in x402-shaped echo route. Toggle the `x-payment` header to see the gate's 402 vs allow path."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <InfoCard label="Route" value="POST /api/seller/echo" />
        <InfoCard label="Gate" value="simpleX402Gate()" />
        <InfoCard label="Header required" value="x-payment" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-brand" /> Hit the seller
          </CardTitle>
          <CardDescription>
            The body is forwarded if (and only if) the <InlineCode>x-payment</InlineCode> header is
            present, mirroring the x402 mock used in the buyer kit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
            <Button onClick={fire} disabled={loading}>
              <Send /> {loading ? 'Sending…' : 'Send request'}
            </Button>
            <button
              type="button"
              onClick={() => setWithPayment((p) => !p)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-elev px-3 h-9 text-xs hover:border-border-strong"
            >
              {withPayment ? (
                <>
                  <Unlock className="size-3.5 text-success" /> include x-payment
                </>
              ) : (
                <>
                  <Lock className="size-3.5 text-warning" /> omit x-payment
                </>
              )}
            </button>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {result && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                Status:{' '}
                <Badge variant={result.status === 200 ? 'success' : 'warning'}>
                  {result.status}
                </Badge>
                {result.withPayment ? (
                  <Badge variant="brand">x-payment sent</Badge>
                ) : (
                  <Badge variant="default">no x-payment</Badge>
                )}
              </div>
              <JsonViewer data={result.body} />
            </div>
          )}
        </CardContent>
      </Card>
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

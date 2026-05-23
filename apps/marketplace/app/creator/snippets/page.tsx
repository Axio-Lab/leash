'use client';

import * as React from 'react';
import { Code2 } from 'lucide-react';

import { SnippetBlock } from '@/components/snippet-block';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

/**
 * /creator/snippets — the seller kit. A standalone page where creators
 * can plug their slug, price, and wallet, and copy ready-to-paste code
 * for any runtime. Independent of any specific listing so creators can
 * prototype before they list.
 */
export default function SnippetsPage() {
  const [slug, setSlug] = React.useState('my-tool');
  const [toolName, setToolName] = React.useState('search');
  const [amount, setAmount] = React.useState('0.001');
  const [currency, setCurrency] = React.useState('USDC');
  const [network, setNetwork] = React.useState<'solana-devnet' | 'solana-mainnet'>('solana-devnet');
  const [payTo, setPayTo] = React.useState('<your-wallet-address>');

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0">
        <Badge
          variant="outline"
          className="border-brand/40 font-mono uppercase tracking-widest text-brand-strong"
        >
          <Code2 className="size-3 mr-1.5" /> Seller kit
        </Badge>
        <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Make any API x402-compliant
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          The seller kit gates your route with a verified Solana stablecoin payment before your
          handler runs. Drop in the snippet that matches your stack, set a price, and you're done.
        </p>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="self-start lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Configure</CardTitle>
            <CardDescription>The values are interpolated into every snippet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Slug">
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
            </Field>
            <Field label="Tool name">
              <Input value={toolName} onChange={(e) => setToolName(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount">
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label="Currency">
                <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </Field>
            </div>
            <div>
              <Label>Network</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(['solana-devnet', 'solana-mainnet'] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    className={cn(
                      'min-h-10 rounded-md border px-3 py-1.5 text-xs uppercase tracking-wide transition-colors',
                      network === n
                        ? 'border-brand bg-brand/15 text-brand-strong'
                        : 'border-border text-fg-muted hover:border-border-strong',
                    )}
                  >
                    {n.replace('solana-', '')}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Pay to (creator wallet)">
              <Input
                value={payTo}
                onChange={(e) => setPayTo(e.target.value)}
                className="font-mono text-xs"
              />
            </Field>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Snippet</CardTitle>
            <CardDescription>
              Copy and paste — the middleware speaks the wire format already supported by every x402
              buyer (incl. our agent runtime).
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <SnippetBlock params={{ slug, toolName, amount, currency, network, payTo }} />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-bg-elev/40">
        <CardHeader>
          <CardTitle>What the middleware does</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <Step n={1} title="Reads x-payment header">
            On the first call the buyer has nothing to pay, so the middleware returns HTTP 402 with
            structured pricing instructions.
          </Step>
          <Step n={2} title="Verifies via the facilitator">
            The buyer signs and retries. The facilitator confirms a valid Solana stablecoin
            transaction landed before letting the request through.
          </Step>
          <Step n={3} title="Forwards to your handler">
            Your code runs only on verified payment. We append the receipt to your listing's stream
            so explorer.leash.market lights up.
          </Step>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-bg/40 p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-brand/15 text-brand-strong text-xs font-semibold">
          {n}
        </span>
        <div className="font-medium">{title}</div>
      </div>
      <p className="mt-2 text-fg-muted">{children}</p>
    </div>
  );
}

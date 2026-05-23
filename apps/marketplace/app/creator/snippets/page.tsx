'use client';

import * as React from 'react';
import { Code2 } from 'lucide-react';

import { SnippetBlock } from '@/components/snippet-block';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import {
  PAYMENT_RAILS,
  STABLE_CURRENCIES,
  type PaymentRail,
  type StableCurrency,
} from '@/lib/seller-kit';

/**
 * /creator/snippets — the seller kit. A standalone page where creators
 * can plug their slug, price, and Leash agent address, and copy ready-to-paste code
 * for any runtime. Independent of any specific listing so creators can
 * prototype before they list.
 */
export default function SnippetsPage() {
  const [slug, setSlug] = React.useState('premium-search');
  const [toolName, setToolName] = React.useState('search');
  const [amount, setAmount] = React.useState('0.001');
  const [currency, setCurrency] = React.useState<StableCurrency>('USDC');
  const [network, setNetwork] = React.useState<'solana-devnet' | 'solana-mainnet'>('solana-devnet');
  const [sellerAgent, setSellerAgent] = React.useState('<your-leash-agent-address>');
  const [upstreamUrl, setUpstreamUrl] = React.useState('https://api.example-search.com/v1/search');
  const [rail, setRail] = React.useState<PaymentRail>('x402');
  const [feePayerAddress, setFeePayerAddress] = React.useState('<facilitator-fee-payer-address>');

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
          handler runs. Payments are attached to a seller agent identity, so receipts and reputation
          can follow the endpoint.
        </p>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="self-start lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Configure</CardTitle>
            <CardDescription>The values are interpolated into every snippet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field id="snippet-slug" label="Slug">
              <Input
                id="snippet-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field id="snippet-tool-name" label="Tool name">
              <Input
                id="snippet-tool-name"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field id="snippet-rail" label="Payment rail">
              <select
                id="snippet-rail"
                value={rail}
                onChange={(e) => setRail(e.target.value as PaymentRail)}
                className="min-h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand/40"
              >
                {PAYMENT_RAILS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} — {r.description}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="snippet-amount" label="Amount">
                <Input
                  id="snippet-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field id="snippet-currency" label="Currency">
                <select
                  id="snippet-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as StableCurrency)}
                  className="min-h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand/40"
                >
                  {STABLE_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <fieldset>
              <legend className="text-sm font-medium text-fg">Network</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(['solana-devnet', 'solana-mainnet'] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={network === n}
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
            </fieldset>
            <Field id="snippet-seller-agent" label="Your Leash agent address">
              <Input
                id="snippet-seller-agent"
                value={sellerAgent}
                onChange={(e) => setSellerAgent(e.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-xs leading-5 text-fg-muted">
                This must be your Leash agent address. seller-kit derives the on-chain payTo PDA
                from it; it is not an arbitrary receiving wallet.
              </p>
            </Field>
            <Field id="snippet-upstream-url" label="Endpoint to run after payment">
              <Input
                id="snippet-upstream-url"
                type="url"
                inputMode="url"
                value={upstreamUrl}
                onChange={(e) => setUpstreamUrl(e.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-xs leading-5 text-fg-muted">
                Paste the API endpoint that should execute only after x402 payment succeeds.
              </p>
            </Field>
            {rail === 'mpp' ? (
              <Field id="snippet-fee-payer" label="MPP fee payer address">
                <Input
                  id="snippet-fee-payer"
                  value={feePayerAddress}
                  onChange={(e) => setFeePayerAddress(e.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <p className="text-xs leading-5 text-fg-muted">
                  MPP challenges include the facilitator fee payer that co-signs settlement.
                </p>
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Snippet</CardTitle>
            <CardDescription>
              Copy and paste — the generated seller uses `createSeller`, your Leash agent address,
              and the live devnet/mainnet facilitator for real x402 settlement.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <SnippetBlock
              params={{
                slug,
                toolName,
                amount,
                currency,
                network,
                sellerAgent,
                upstreamUrl,
                rail,
                feePayerAddress,
              }}
            />
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
            Your code runs only on verified payment. Forward the earn receipt to the Leash API or
            runner if you want explorer.leash.market to show the trade immediately.
          </Step>
        </CardContent>
      </Card>
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

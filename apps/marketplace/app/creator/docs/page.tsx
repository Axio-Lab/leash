import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Code2,
  KeyRound,
  PackagePlus,
  Sparkles,
  Wallet,
} from 'lucide-react';

import { SnippetBlock } from '@/components/snippet-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

/**
 * Creator-facing documentation. Server component (renderable, indexable)
 * walking through the full flow: who lists, why, exactly what to upload,
 * and what the seller-kit middleware does.
 */
export default function CreatorDocsPage() {
  return (
    <div className="space-y-12 max-w-[900px]">
      <header className="space-y-3">
        <Badge variant="outline" className="font-mono uppercase tracking-widest">
          <BookOpen className="size-3 mr-1.5" /> How it works
        </Badge>
        <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
          List an agent capability on leash.market in three steps
        </h1>
        <p className="max-w-2xl text-fg-muted">
          leash.market is the open registry where agent identities discover, pay for, and use
          capabilities. If you operate an API, an MCP server, or even a single agent service, you
          can list it here — free or paid — and start collecting USDC per call.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: Sparkles,
            title: 'Anyone can list',
            body: 'Devs, agent creators, indie operators.',
          },
          { icon: Wallet, title: 'Per-call USDC', body: 'Settles in seconds via x402 + Solana.' },
          {
            icon: CheckCircle2,
            title: 'Onchain receipts',
            body: 'Every call leaves a verifiable trail.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <Card key={title} className="p-4">
            <Icon className="size-4 text-brand-strong" />
            <div className="mt-2 font-semibold">{title}</div>
            <p className="text-xs text-fg-muted">{body}</p>
          </Card>
        ))}
      </section>

      <section className="space-y-4">
        <SectionHead n={1} icon={KeyRound} title="Get an API key">
          Sign in with email or Solana wallet, then issue an{' '}
          <code className="font-mono text-fg">lsh_*</code> key with{' '}
          <code className="font-mono text-fg">marketplace</code> scope. Use it to manage listings
          programmatically.
        </SectionHead>
        <Button asChild variant="outline">
          <Link href="/creator/api-keys">
            Issue a key <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <section className="space-y-4">
        <SectionHead n={2} icon={PackagePlus} title="Describe your capability">
          A leash listing is a JSON document. You can paste a URL to a hosted manifest (recommended)
          or fill the fields by hand. Here's the canonical shape:
        </SectionHead>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Example leash-mcp.json</CardTitle>
            <CardDescription>
              Host this on your endpoint at{' '}
              <code className="font-mono text-fg">/.well-known/leash-mcp.json</code>. We re-fetch it
              whenever you ask us to refresh.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SnippetBlock
              defaultLanguage="manifest"
              params={{
                slug: 'premium-search',
                toolName: 'search',
                amount: '0.001',
                currency: 'USDC',
                network: 'solana-devnet',
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Field-by-field</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <FieldDef label="name">Display name. Free-form, ≤80 chars.</FieldDef>
              <FieldDef label="slug">
                URL-safe id (a–z, 0–9, dashes). The page lives at{' '}
                <code className="font-mono text-fg">leash.market/listing/&lt;slug&gt;</code>.
              </FieldDef>
              <FieldDef label="description">
                One sentence written for an agent, not a human. Be specific about what input/output
                shape your capability accepts.
              </FieldDef>
              <FieldDef label="category">
                Free-form bucket — search, data, payments, compute, social, misc. Used for browse
                filters.
              </FieldDef>
              <FieldDef label="endpoint">
                Public HTTPS URL the agent identity will call. For an MCP server, this is the MCP
                endpoint. For a paid REST API, the resource URL.
              </FieldDef>
              <FieldDef label="pricing.type">
                One of <code className="font-mono text-fg">free</code>,{' '}
                <code className="font-mono text-fg">per_call</code>, or{' '}
                <code className="font-mono text-fg">variable</code>.
              </FieldDef>
              <FieldDef label="pricing.amount">
                Decimal string in the listed currency. Per-call only.
              </FieldDef>
              <FieldDef label="pricing.currency">
                Currently <code className="font-mono text-fg">USDC</code>. More stablecoins land
                with x402 ecosystem rollouts.
              </FieldDef>
              <FieldDef label="tools[]">
                List of callable tools inside this capability. Each has{' '}
                <code className="font-mono text-fg">name</code>,{' '}
                <code className="font-mono text-fg">description</code>, and an optional{' '}
                <code className="font-mono text-fg">inputSchema</code> (JSON Schema).
              </FieldDef>
              <FieldDef label="docs_url (optional)">
                Where humans can read about your capability.
              </FieldDef>
              <FieldDef label="free_tier (optional)">
                Calls per buyer per day before payment kicks in. Great for converting curious agent
                identities into paying ones.
              </FieldDef>
            </dl>
          </CardContent>
        </Card>
        <Button asChild>
          <Link href="/creator/list">
            Start a listing <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <section className="space-y-4">
        <SectionHead n={3} icon={Code2} title="Wrap your endpoint with the seller kit">
          The seller-kit middleware short-circuits unauthenticated requests with HTTP 402 and only
          forwards to your handler once an x402 payment has been verified. Pick the runtime that
          matches your stack — full snippets live on the seller-kit page.
        </SectionHead>
        <Card>
          <CardContent className="pt-5">
            <SnippetBlock
              params={{ slug: 'premium-search', toolName: 'search', amount: '0.001' }}
            />
          </CardContent>
        </Card>
        <Button asChild variant="outline">
          <Link href="/creator/snippets">
            Open seller kit <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <section className="rounded-xl border bg-aurora p-8 text-center space-y-3">
        <h3 className="text-2xl font-semibold tracking-tight">That's it.</h3>
        <p className="max-w-xl mx-auto text-fg-muted">
          Once your listing is approved, every agent identity on{' '}
          <a
            href={NEXT_PUBLIC_AGENTS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-brand-strong hover:underline"
          >
            agent.leash.market
          </a>{' '}
          can add it as a capability with a single click — and your wallet starts collecting USDC
          per call.
        </p>
        <div className="flex justify-center gap-2">
          <Button asChild>
            <Link href="/creator/list">List a capability</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/browse">Browse the registry</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function SectionHead({
  n,
  icon: Icon,
  title,
  children,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-fg-muted">
        <span className="grid size-6 place-items-center rounded-full bg-brand/20 text-brand-strong text-xs font-semibold">
          {n}
        </span>
        <Icon className="size-4 text-brand-strong" />
        <span className="text-xs uppercase tracking-widest">Step {n}</span>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-2xl text-sm text-fg-muted">{children}</p>
    </div>
  );
}

function FieldDef({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-bg/40 p-3">
      <div className="font-mono text-xs text-brand-strong">{label}</div>
      <div className="mt-1 text-fg-muted">{children}</div>
    </div>
  );
}

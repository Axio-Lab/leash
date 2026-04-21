'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { ArrowLeft, Coins, Cog, FileText, Wallet as WalletIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReceiptV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReceiptRow } from '@/components/receipt-row';
import { JsonViewer } from '@/components/json-viewer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/page-header';
import { jsonFetcher } from '@/lib/fetcher';

type FeedRes = {
  mint: string;
  receipts: ReceiptV1[];
  errors: Array<{ line: number; error: string }>;
};

export default function AgentPage() {
  const params = useParams<{ mint: string }>();
  const mint = decodeURIComponent(params.mint);
  const [registryUri, setRegistryUri] = React.useState('');

  const { data: feed } = useSWR<FeedRes>(mint ? `/api/receipts/${mint}` : null, jsonFetcher, {
    refreshInterval: 4000,
  });

  const { data: payTo } = useSWR<{ asset: string; payTo: string; error?: string }>(
    mint ? `/api/seller/payTo?asset=${mint}` : null,
    jsonFetcher,
  );

  const { data: registration, mutate: refetchReg } = useSWR<{
    uri: string;
    document: unknown;
    source: string;
    error?: string;
  }>(
    registryUri ? `/api/registry/resolve?uri=${encodeURIComponent(registryUri)}` : null,
    jsonFetcher,
  );

  const earnCount = feed?.receipts.filter((r) => r.kind === 'earn').length ?? 0;
  const spendCount = feed?.receipts.filter((r) => r.kind === 'spend').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg w-fit"
      >
        <ArrowLeft className="size-3" /> All agents
      </Link>
      <PageHeader
        eyebrow="Agent profile"
        title={<span className="font-mono text-xl break-all">{mint}</span>}
        description="Identity, treasury, capabilities, and the on-runner receipt feed for this Core asset."
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href={`/a/${mint}/receipts.jsonl`} target="_blank" rel="noreferrer">
              receipts.jsonl
            </a>
          </Button>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <WalletIcon className="size-3.5" /> Treasury (Asset Signer PDA)
            </CardDescription>
            <CardTitle className="font-mono text-xs break-all">
              {payTo?.error ? (
                <span className="text-danger">{payTo.error}</span>
              ) : payTo?.payTo ? (
                payTo.payTo
              ) : (
                'computing…'
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Coins className="size-3.5" /> Earn / Spend
            </CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="success">earn {earnCount}</Badge>
              <Badge variant="brand">spend {spendCount}</Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Cog className="size-3.5" /> Network
            </CardDescription>
            <CardTitle className="text-sm">Solana devnet</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Tabs defaultValue="receipts">
        <TabsList>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="identity">Identity (registration)</TabsTrigger>
        </TabsList>

        <TabsContent value="receipts">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-brand" /> Receipt feed
              </CardTitle>
              <CardDescription>
                Tail of the runner's <code className="font-mono">receipts.jsonl</code> for this
                agent. Auto-refreshing every 4s.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!feed && <p className="text-sm text-fg-muted">Loading…</p>}
              {feed && feed.receipts.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                  No receipts yet for this agent.
                </div>
              )}
              {feed?.receipts
                .slice()
                .reverse()
                .map((r) => (
                  <ReceiptRow key={r.receipt_hash} receipt={r} />
                ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle>Registration document</CardTitle>
              <CardDescription>
                Paste the agent's published registration URI (Pinata / IPFS / HTTPS). We fetch and
                validate it against <code className="font-mono">RegistrationV1</code> via{' '}
                <code className="font-mono">@leash/registry-utils</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="uri">Registration URI</Label>
                <div className="flex gap-2">
                  <Input
                    id="uri"
                    value={registryUri}
                    onChange={(e) => setRegistryUri(e.target.value)}
                    placeholder="https://gateway.pinata.cloud/ipfs/..."
                  />
                  <Button variant="secondary" onClick={() => refetchReg()}>
                    Resolve
                  </Button>
                </div>
              </div>
              {registration?.error ? (
                <p className="text-sm text-danger">{registration.error}</p>
              ) : registration?.document ? (
                <JsonViewer data={registration.document} maxHeight="32rem" />
              ) : (
                <p className="text-xs text-fg-subtle">No document loaded yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

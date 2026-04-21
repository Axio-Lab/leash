'use client';

import * as React from 'react';
import useSWR from 'swr';
import { RefreshCw, Activity, Pause, Play, Hash } from 'lucide-react';
import type { ReceiptV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ReceiptRow } from '@/components/receipt-row';
import { PageHeader } from '@/components/page-header';
import { jsonFetcher } from '@/lib/fetcher';

type FeedRes = {
  mint: string;
  receipts: ReceiptV1[];
  errors: Array<{ line: number; error: string }>;
};

type PauseRes = {
  paused?: boolean;
  source?: string;
  env_kill?: boolean;
  error?: string;
};

const DEFAULT_MINT = '11111111111111111111111111111111';

export default function RunnerPage() {
  const [mint, setMint] = React.useState(DEFAULT_MINT);
  const [pollMs, setPollMs] = React.useState(3000);

  const { data: pause } = useSWR<PauseRes>('/api/runner/pause', jsonFetcher, {
    refreshInterval: 5000,
  });
  const { data: feed, mutate } = useSWR<FeedRes>(
    mint ? `/api/receipts/${mint}` : null,
    jsonFetcher,
    { refreshInterval: pollMs },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leash/runner"
        title="Runner explorer"
        description="Live view of an agent's `receipts.jsonl` plus the runner's pause + kill-switch state."
        actions={
          <Button variant="secondary" size="sm" onClick={() => mutate()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Status</CardDescription>
            <CardTitle className="flex items-center gap-2">
              {pause?.paused ? (
                <>
                  <Pause className="size-4 text-warning" /> Paused
                  <Badge variant="warning">{pause.source}</Badge>
                </>
              ) : pause?.error ? (
                <>
                  <Activity className="size-4 text-danger" /> offline
                </>
              ) : (
                <>
                  <Play className="size-4 text-success" /> Live
                  <Badge variant="success">{pause?.source ?? '…'}</Badge>
                </>
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Receipts in feed</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Hash className="size-4 text-fg-muted" />
              {feed?.receipts.length ?? 0}
            </CardTitle>
            {feed?.errors.length ? (
              <p className="text-xs text-warning">
                {feed.errors.length} malformed line{feed.errors.length === 1 ? '' : 's'}
              </p>
            ) : null}
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Polling</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Input
                type="number"
                min={500}
                step={500}
                value={pollMs}
                onChange={(e) => setPollMs(Number(e.target.value))}
                className="h-7 w-24"
              />
              <span className="text-xs text-fg-subtle">ms</span>
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Agent feed</CardTitle>
          <CardDescription>
            Tail of <code className="font-mono">/a/&lt;mint&gt;/receipts.jsonl</code>. Default uses
            the demo mint; paste a real Core asset mint to inspect production data.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mint">Agent mint</Label>
            <Input
              id="mint"
              value={mint}
              spellCheck={false}
              onChange={(e) => setMint(e.target.value.trim())}
              placeholder="Core asset mint"
              className="font-mono"
            />
          </div>

          <Separator />

          {!feed && <p className="text-sm text-fg-muted">Loading…</p>}
          {feed && feed.receipts.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
              No receipts yet for{' '}
              <code className="font-mono text-xs">{mint.slice(0, 16)}…</code>. Fire one from the{' '}
              <a className="text-brand hover:underline" href="/buyer">
                buyer playground
              </a>
              .
            </div>
          )}
          {feed && feed.receipts.length > 0 && (
            <div className="flex flex-col gap-2">
              {feed.receipts
                .slice()
                .reverse()
                .map((r) => (
                  <ReceiptRow key={r.receipt_hash} receipt={r} />
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

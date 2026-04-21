'use client';

import * as React from 'react';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/fetcher';
import { WalletButton } from '@/components/wallet-button';
import { Badge } from '@/components/ui/badge';

type HealthRes = { ok: boolean; paused: boolean; source?: string; error?: string };

export function Topbar() {
  const { data } = useSWR<HealthRes>('/api/runner/health', jsonFetcher, {
    refreshInterval: 5000,
  });

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/85 px-6 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <RunnerStatus data={data} />
      </div>
      <div className="flex items-center gap-2">
        <WalletButton />
      </div>
    </header>
  );
}

function RunnerStatus({ data }: { data?: HealthRes }) {
  if (!data) {
    return (
      <Badge variant="default">
        <Dot color="var(--color-fg-muted)" /> runner: connecting…
      </Badge>
    );
  }
  if (data.error || data.ok === undefined) {
    return (
      <Badge variant="danger" title={data.error ? `Health check failed: ${data.error}` : undefined}>
        <Dot color="var(--color-danger)" /> runner: offline
      </Badge>
    );
  }
  if (data.paused) {
    return (
      <Badge variant="warning">
        <Dot color="var(--color-warning)" /> runner paused ({data.source})
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      <Dot color="var(--color-success)" /> runner: live
    </Badge>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="size-1.5 rounded-full" style={{ background: color }} />;
}

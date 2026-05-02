'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { jsonFetcher } from '@/lib/fetcher';
import { WalletButton } from '@/components/wallet-button';
import { Badge } from '@/components/ui/badge';
import { useSidebar } from '@/lib/sidebar-context';

type HealthRes = { ok: boolean; paused: boolean; source?: string; error?: string };

export function Topbar() {
  const { collapsed, toggleCollapsed, toggleMobileOpen } = useSidebar();
  const { data } = useSWR<HealthRes>('/api/runner/health', jsonFetcher, {
    refreshInterval: 5000,
  });

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-bg/85 px-3 sm:px-4 md:px-6 backdrop-blur-md">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={toggleMobileOpen}
          className="md:hidden rounded-md p-1.5 text-fg-muted hover:text-fg hover:bg-bg-elev"
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </button>
        {/*
         * Desktop sidebar toggle. Lives in the topbar (not just inside the
         * rail) so users who collapse to icons-only have an obvious,
         * always-visible "expand again" affordance — no hunting for a tiny
         * chevron at the bottom of the rail.
         */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden md:inline-flex rounded-md p-1.5 text-fg-muted hover:text-fg hover:bg-bg-elev"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
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

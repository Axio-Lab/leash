'use client';

import Image from 'next/image';
import Link from 'next/link';
import * as React from 'react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';
import { LogOutIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';

import { WalletGate } from '@/components/wallet-gate';
import { readOnboardingSkipped } from '@/components/chat/onboarding-gate';
import { setActiveUser } from '@/lib/chat-storage';
import { InboundReceipts } from '@/components/chat/inbound-receipts';
import { ChatSidebar } from './chat-sidebar';

const agentsFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ items: Array<{ mint?: string }> }>;
};

export function ChatShell({
  children,
  activeThreadId,
  privyId,
  chatRoute,
}: {
  children: React.ReactNode;
  activeThreadId: string | null;
  privyId: string;
  chatRoute: boolean;
}) {
  const { user, logout } = usePrivy();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(true);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    setActiveUser(privyId);
  }, [privyId]);

  React.useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 1024);
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem('leash:chat_sidebar_collapsed');
    if (raw !== null) {
      setSidebarCollapsed(raw === '1');
    } else {
      setSidebarCollapsed(window.innerWidth < 1024);
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('leash:chat_sidebar_collapsed', next ? '1' : '0');
      }
      return next;
    });
  }

  const { data: agentsData } = useSWR('/api/agents', agentsFetcher);
  const primaryMint = agentsData?.items?.[0]?.mint ?? null;
  // Banner shows whenever no agent has been minted — even after the user
  // tapped "Skip for now" — so the missing-setup state is always visible.
  // We still call `readOnboardingSkipped` to avoid breaking the import; the
  // value is kept for future "Don't show again" semantics.
  void readOnboardingSkipped;
  const showOnboardingReminder =
    chatRoute && agentsData && Array.isArray(agentsData.items) && agentsData.items.length === 0;

  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solanaWallet = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solanaWallet?.address ?? '';
  const walletShort = wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : '';

  const sidebarOpen = !sidebarCollapsed;

  return (
    <WalletGate>
      <div className="h-dvh flex flex-col overflow-hidden bg-bg">
        {/* ── Header — always on top, covers nothing ── */}
        <header className="shrink-0 border-b border-border px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 bg-bg/90 backdrop-blur-md relative z-50">
          <button
            type="button"
            onClick={toggleSidebar}
            className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-fg-muted hover:border-border-strong hover:text-fg"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpenIcon className="size-4" />
            ) : (
              <PanelLeftCloseIcon className="size-4" />
            )}
          </button>
          <span className="flex items-center gap-2 font-semibold tracking-tight flex-1 truncate">
            <Image
              src="/leash-logo.png"
              alt="Leash"
              width={22}
              height={22}
              className="shrink-0 select-none [filter:brightness(0)_invert(1)]"
              priority
            />
            leash · agents
          </span>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {walletShort ? (
              <span className="hidden sm:inline text-xs text-fg-muted font-mono">
                {walletShort}
              </span>
            ) : null}
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-fg-muted hover:border-border-strong hover:text-fg"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOutIcon className="size-4" />
            </button>
          </div>
        </header>

        {/* ── Onboarding banner ── */}
        {showOnboardingReminder ? (
          <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-warning/30 bg-warning/8 text-xs text-fg flex flex-wrap items-center justify-between gap-2 relative z-40">
            <span>
              <span className="text-warning font-medium">Agent not set up.</span> Mint your on-chain
              agent to unlock treasury spend and marketplace tools.
            </span>
            <Link
              href="/profile/agent"
              className="font-medium text-brand hover:underline whitespace-nowrap"
            >
              Set up agent →
            </Link>
          </div>
        ) : null}

        {chatRoute ? <InboundReceipts agentMint={primaryMint} /> : null}

        {/* ── Body: drawer overlays only this region on mobile ── */}
        <div className="flex flex-1 min-h-0 items-stretch relative">
          {/* Mobile drawer backdrop — covers body only, header stays visible */}
          {sidebarOpen && isMobile ? (
            <button
              type="button"
              aria-label="Close sidebar"
              className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={toggleSidebar}
            />
          ) : null}

          {/* Mobile drawer — absolute, only fills body height */}
          {sidebarOpen && isMobile ? (
            <div className="absolute inset-y-0 left-0 z-40 lg:hidden">
              <ChatSidebar
                privyId={privyId}
                activeThreadId={activeThreadId}
                onLogout={logout}
                onNavigate={toggleSidebar}
              />
            </div>
          ) : null}

          {/* Desktop sidebar — normal flow */}
          {sidebarOpen && !isMobile ? (
            <ChatSidebar privyId={privyId} activeThreadId={activeThreadId} onLogout={logout} />
          ) : null}

          <div className="flex-1 flex flex-col min-w-0 min-h-0">{children}</div>
        </div>
      </div>
    </WalletGate>
  );
}

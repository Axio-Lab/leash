'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import Image from 'next/image';
import {
  ArrowUpRight,
  BookOpen,
  Code2,
  Compass,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { WalletGate } from '@/components/wallet-gate';
import { cn } from '@/lib/cn';
import { NEXT_PUBLIC_AGENTS_URL, NEXT_PUBLIC_PRIVY_APP_ID } from '@/lib/env';

/**
 * Sidebar shell used by every authenticated creator route under the
 * `(creator)` segment. Matches the modern dashboards Vercel / Linear
 * ship — sticky sidebar on desktop, drawer on mobile, soft glow on the
 * active nav row.
 *
 * Auth gating happens here too: we render an in-place sign-in card
 * until Privy resolves a session. That's the whole reason we don't
 * `redirect()` — bouncing between routes loses intent (e.g. a deep
 * link to `/creator/list`).
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const PRIMARY: NavItem[] = [
  { href: '/creator', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/creator/tools', label: 'My tools', icon: PackagePlus },
  { href: '/creator/list', label: 'List a tool', icon: Sparkles, badge: 'New' },
  { href: '/creator/snippets', label: 'Seller kit', icon: Code2 },
];

const SECONDARY: NavItem[] = [
  { href: '/creator/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/creator/docs', label: 'How it works', icon: BookOpen },
];

export function CreatorShell({ children }: { children: React.ReactNode }) {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <div className="min-h-dvh grid place-items-center text-center text-sm text-fg-muted px-6">
        Configure <code className="mx-1 text-brand">NEXT_PUBLIC_PRIVY_APP_ID</code> to enable login.
      </div>
    );
  }
  return <Inner>{children}</Inner>;
}

function Inner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  React.useEffect(() => setDrawerOpen(false), [pathname]);

  if (!ready) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <Spinner size="lg" brand />
      </div>
    );
  }
  if (!authenticated) {
    return <SignInGate onLogin={login} />;
  }

  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solana = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solana?.address ?? '';
  const short = wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : 'connected';

  return (
    <div className="min-h-dvh grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Sidebar — desktop */}
      <aside className="hidden border-r border-border bg-bg-elev/40 lg:flex lg:flex-col">
        <SidebarBody pathname={pathname} short={short} onLogout={logout} />
      </aside>

      {/* Sidebar — mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-[280px] flex-col border-r border-border bg-bg-elev">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-3 rounded-md border p-1 text-fg-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
            <SidebarBody pathname={pathname} short={short} onLogout={logout} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-dvh flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-xl lg:px-6">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md border p-1.5 text-fg-muted hover:text-fg lg:hidden"
          >
            <Menu className="size-4" />
          </button>
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Compass className="size-4 text-brand-strong" />
            <span className="truncate">{titleForPath(pathname)}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <a href={NEXT_PUBLIC_AGENTS_URL} target="_blank" rel="noreferrer">
                Agent platform <ArrowUpRight className="size-3.5" />
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/creator/list')}
              className="hidden sm:inline-flex"
            >
              List a tool
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 lg:px-10">
          <WalletGate>{children}</WalletGate>
        </main>
      </div>
    </div>
  );
}

function SidebarBody({
  pathname,
  short,
  onLogout,
}: {
  pathname: string;
  short: string;
  onLogout: () => void;
}) {
  const isActive = (href: string) =>
    href === '/creator' ? pathname === '/creator' : pathname.startsWith(href);
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Image
          src="/leash-logo.png"
          alt="Leash"
          width={20}
          height={20}
          className="[filter:brightness(0)_invert(1)] shrink-0"
          priority
        />
        <Link href="/" className="text-sm font-semibold tracking-tight">
          leash<span className="text-fg-muted">.market</span>
        </Link>
        <Badge variant="outline" className="ml-auto font-mono uppercase">
          Creator
        </Badge>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto scrollbar-thin">
        <NavGroup label="Build" items={PRIMARY} isActive={isActive} />
        <NavGroup label="Settings" items={SECONDARY} isActive={isActive} />
      </nav>

      <div className="border-t border-border p-3 space-y-2">
        <div className="rounded-lg border bg-bg p-3">
          <div className="text-[10px] uppercase tracking-widest text-fg-subtle">Wallet</div>
          <div className="mt-1 font-mono text-xs">{short}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className="w-full justify-start text-fg-muted hover:text-fg"
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </>
  );
}

function NavGroup({
  label,
  items,
  isActive,
}: {
  label: string;
  items: NavItem[];
  isActive: (href: string) => boolean;
}) {
  return (
    <div>
      <div className="px-3 pb-2 text-[10px] uppercase tracking-widest text-fg-subtle">{label}</div>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-brand/15 text-fg shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
                    : 'text-fg-muted hover:bg-bg-elev hover:text-fg',
                )}
              >
                <item.icon
                  className={cn(
                    'size-4 transition-colors',
                    active ? 'text-brand-strong' : 'text-fg-subtle group-hover:text-fg-muted',
                  )}
                />
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0">
                    {item.badge}
                  </Badge>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SignInGate({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <div className="max-w-md w-full rounded-xl border bg-aurora p-8 text-center space-y-4">
        <Shield className="size-7 mx-auto text-brand-strong" />
        <h2 className="text-xl font-semibold tracking-tight">Sign in as creator</h2>
        <p className="text-sm text-fg-muted">
          Manage your tools, listings, API keys, and seller kit. Email or Solana wallet — your call.
        </p>
        <Button onClick={onLogin} className="w-full" size="lg">
          Sign in
        </Button>
        <p className="text-xs text-fg-subtle">
          New here?{' '}
          <Link href="/" className="hover:text-fg-muted underline-offset-2 hover:underline">
            See what leash.market is
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function titleForPath(p: string): string {
  if (p === '/creator') return 'Dashboard';
  if (p.startsWith('/creator/tools')) return 'My tools';
  if (p.startsWith('/creator/list')) return 'List a tool';
  if (p.startsWith('/creator/snippets')) return 'Seller kit';
  if (p.startsWith('/creator/api-keys')) return 'API keys';
  if (p.startsWith('/creator/docs')) return 'How it works';
  if (p.startsWith('/creator/admin')) return 'Admin';
  return 'Creator';
}

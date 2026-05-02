'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Activity,
  Bot,
  ShoppingBag,
  Send,
  FileJson2,
  ExternalLink,
  Sparkles,
  ChevronsLeft,
  ChevronsRight,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSidebar } from '@/lib/sidebar-context';

const NAV: Array<{ href: string; label: string; icon: React.ElementType; group: string }> = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { href: '/runner', label: 'Runner', icon: Activity, group: 'Overview' },
  { href: '/agents', label: 'Agents', icon: Bot, group: 'Build' },
  { href: '/agents/new', label: 'Create agent', icon: Sparkles, group: 'Build' },
  { href: '/seller', label: 'Seller playground', icon: ShoppingBag, group: 'Build' },
  { href: '/buyer', label: 'Buyer playground', icon: Send, group: 'Build' },
  { href: '/schemas', label: 'Schemas', icon: FileJson2, group: 'Tools' },
];

const GROUPS = Array.from(new Set(NAV.map((item) => item.group)));

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();

  // The same nav body is rendered twice — once for the persistent desktop
  // rail (hidden <md) and once inside the mobile drawer overlay (hidden ≥md).
  // Pulling it into a closure keeps both renderings in lockstep without
  // hoisting a third "RailContents" component.
  const renderNav = (mode: 'desktop' | 'mobile') => {
    const showLabels = mode === 'mobile' || !collapsed;
    return (
      <nav className="flex flex-col gap-3.5">
        {GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-0.5">
            {showLabels ? (
              <span className="px-2 pb-0.5 text-[9px] font-medium uppercase tracking-widest text-fg-subtle">
                {group}
              </span>
            ) : (
              // Subtle divider so collapsed mode still communicates grouping.
              <span className="mx-2 mb-0.5 h-px bg-border/60" aria-hidden />
            )}
            {NAV.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              // If a more specific child route is active (e.g. `/agents/new`
              // when on `/agents/new`), don't also light up the parent
              // (`/agents`). Without this both rows would appear active.
              const hasMoreSpecific = NAV.some(
                (other) =>
                  other.href !== item.href &&
                  other.href.startsWith(`${item.href}/`) &&
                  (pathname === other.href || pathname.startsWith(`${other.href}/`)),
              );
              const active =
                !hasMoreSpecific &&
                (pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(`${item.href}/`)));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => mode === 'mobile' && setMobileOpen(false)}
                  title={!showLabels ? item.label : undefined}
                  aria-label={!showLabels ? item.label : undefined}
                  className={cn(
                    'flex items-center rounded-md text-[12px] transition-colors',
                    showLabels ? 'gap-2 px-2 py-1.5' : 'h-8 w-8 mx-auto justify-center',
                    active
                      ? 'bg-bg-elev-2 text-fg'
                      : 'text-fg-muted hover:text-fg hover:bg-bg-elev',
                  )}
                >
                  <Icon className={cn('opacity-80 shrink-0', showLabels ? 'size-4' : 'size-4')} />
                  {showLabels && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    );
  };

  const renderFooter = (mode: 'desktop' | 'mobile') => {
    const showLabels = mode === 'mobile' || !collapsed;
    if (!showLabels) {
      return (
        <div className="mt-auto flex flex-col items-center gap-2 text-fg-subtle">
          <a
            href="https://github.com/Axio-Lab/leash"
            target="_blank"
            rel="noreferrer"
            title="GitHub"
            className="hover:text-fg-muted"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <a
            href="https://docs.leash.market"
            target="_blank"
            rel="noreferrer"
            title="Documentation"
            className="hover:text-fg-muted"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <span className="text-[9px] uppercase tracking-widest">v0.1</span>
        </div>
      );
    }
    return (
      <div className="mt-auto flex flex-col gap-1.5 text-[10.5px] text-fg-subtle">
        <a
          href="https://github.com/Axio-Lab/leash"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-fg-muted"
        >
          GitHub <ExternalLink className="size-3" />
        </a>
        <a
          href="https://docs.leash.market"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-fg-muted"
        >
          Docs <ExternalLink className="size-3" />
        </a>
        <span>v0.1 · devnet</span>
      </div>
    );
  };

  return (
    <>
      {/* Desktop rail.
          - `sticky top-0 h-dvh` pins the rail to the viewport so it never
            scrolls past the bottom of long pages and never grows taller
            than the screen.
          - The inner `<div>` between the header and the footer takes
            `flex-1 overflow-y-auto min-h-0` so when nav items would
            otherwise overflow (small laptops, future menu growth), the
            *nav* scrolls instead of pushing the footer off-screen.
          - `min-h-0` is required on the scrollable child of a flex column,
            otherwise it inherits its content's intrinsic height and
            refuses to shrink. */}
      <aside
        className={cn(
          'hidden md:flex sticky top-0 h-dvh shrink-0 flex-col gap-3 border-r border-border bg-bg-elev/40 py-4 transition-[width] duration-200 ease-out',
          collapsed ? 'w-12 px-1.5' : 'w-52 px-3',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 shrink-0',
            collapsed ? 'flex-col' : 'justify-between',
          )}
        >
          <Link
            href="/"
            className="flex items-center gap-2"
            title={collapsed ? 'Leash Playground' : undefined}
          >
            <Image
              src="/images/leash_icon.svg"
              alt="Leash"
              width={48}
              height={48}
              priority
              className="size-7 rounded-md shadow-inner shadow-black/20"
            />
            {!collapsed && (
              <div className="flex flex-col leading-tight">
                <span className="text-[12px] font-semibold tracking-tight">Leash</span>
                <span className="text-[9px] uppercase tracking-widest text-fg-subtle">
                  Playground
                </span>
              </div>
            )}
          </Link>
          {/*
           * Collapse / expand toggle. When expanded it sits to the right of
           * the wordmark; when collapsed it stacks directly below the L
           * logo so it's the second thing users see at the top of the
           * rail (no more hunting for it at the footer).
           */}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-md p-1 text-fg-subtle hover:text-fg hover:bg-bg-elev"
          >
            {collapsed ? (
              <ChevronsRight className="size-3.5" />
            ) : (
              <ChevronsLeft className="size-3.5" />
            )}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar -mx-1 px-1">
          {renderNav('desktop')}
        </div>
        <div className="shrink-0">{renderFooter('desktop')}</div>
      </aside>

      {/* Mobile drawer + scrim. We mount both with always-present DOM and
          toggle visibility with `data-open` so the slide animation works
          on close as well as open. */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          'md:hidden fixed inset-y-0 left-0 z-50 flex w-60 flex-col gap-3 border-r border-border bg-bg p-4 shadow-xl transition-transform duration-200 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!mobileOpen}
      >
        <div className="flex items-center justify-between shrink-0">
          <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
            <Image
              src="/images/leash_icon.svg"
              alt="Leash"
              width={28}
              height={28}
              priority
              className="size-7 rounded-md shadow-inner shadow-black/20"
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[12px] font-semibold tracking-tight">Leash</span>
              <span className="text-[9px] uppercase tracking-widest text-fg-subtle">
                Playground
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-md p-1 text-fg-subtle hover:text-fg hover:bg-bg-elev"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Same scrollable middle pattern as the desktop rail so the
            mobile drawer never overflows the viewport on short phones
            (e.g. landscape orientation). */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar -mx-1 px-1">
          {renderNav('mobile')}
        </div>
        <div className="shrink-0">{renderFooter('mobile')}</div>
      </aside>
    </>
  );
}

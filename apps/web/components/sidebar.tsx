'use client';

import * as React from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/cn';

const NAV: Array<{ href: string; label: string; icon: React.ElementType; group: string }> = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { href: '/runner', label: 'Runner', icon: Activity, group: 'Overview' },
  { href: '/agents', label: 'Agents', icon: Bot, group: 'Build' },
  { href: '/seller', label: 'Seller playground', icon: ShoppingBag, group: 'Build' },
  { href: '/buyer', label: 'Buyer playground', icon: Send, group: 'Build' },
  { href: '/schemas', label: 'Schemas', icon: FileJson2, group: 'Tools' },
];

export function Sidebar() {
  const pathname = usePathname();
  const groups = Array.from(new Set(NAV.map((item) => item.group)));

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col gap-6 border-r border-border bg-bg-elev/40 p-5">
      <Link href="/" className="flex items-center gap-2">
        <div className="size-8 rounded-md bg-linear-to-br from-brand to-brand-strong shadow-inner shadow-black/20 flex items-center justify-center text-bg font-bold">
          L
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight">Leash</span>
          <span className="text-[10px] uppercase tracking-widest text-fg-subtle">Playground</span>
        </div>
      </Link>

      <nav className="flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-1">
            <span className="px-2 text-[10px] font-medium uppercase tracking-widest text-fg-subtle">
              {group}
            </span>
            {NAV.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-bg-elev-2 text-fg'
                      : 'text-fg-muted hover:text-fg hover:bg-bg-elev',
                  )}
                >
                  <Icon className="size-4 opacity-80" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 text-[11px] text-fg-subtle">
        <a
          href="https://github.com/leash-protocol"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-fg-muted"
        >
          GitHub <ExternalLink className="size-3" />
        </a>
        <a
          href="http://localhost:3001"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-fg-muted"
        >
          Docs <ExternalLink className="size-3" />
        </a>
        <span className="text-fg-subtle">v0.1 · devnet</span>
      </div>
    </aside>
  );
}

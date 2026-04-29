'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDownIcon } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const links = [
  { href: '/settings', label: 'Overview' },
  { href: '/settings/connections', label: 'Connections' },
  { href: '/settings/favorites', label: 'Favorites' },
  { href: '/settings/skills', label: 'Skills' },
  { href: '/settings/spend', label: 'Spend' },
  { href: '/settings/llm', label: 'LLM keys' },
  { href: '/settings/api-keys', label: 'API keys' },
] as const;

function navActive(href: string, pathname: string): boolean {
  if (href === '/settings') return pathname === '/settings';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Settings navigation:
 * - On phones we render a single picker (dropdown) so the whole row never
 *   overflows the viewport. The trigger shows the current section.
 * - On larger screens we render a wrapping pill row — `flex-wrap` so labels
 *   shuffle to a second line on tight widths instead of producing the
 *   sideways scroll we used to have.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const current = links.find((l) => navActive(l.href, pathname)) ?? links[0]!;

  return (
    <>
      {/* Mobile: section picker */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-elev/60 px-3.5 py-2.5 text-sm text-fg hover:border-border-strong"
            >
              <span className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-fg-subtle">
                  Section
                </span>
                <span className="font-medium">{current.label}</span>
              </span>
              <ChevronDownIcon className="size-4 text-fg-subtle" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[var(--radix-dropdown-menu-trigger-width)]"
          >
            {links.map((l) => {
              const active = navActive(l.href, pathname);
              return (
                <DropdownMenuItem key={l.href} asChild>
                  <Link href={l.href} className={`w-full ${active ? 'bg-brand/15 text-fg' : ''}`}>
                    {l.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="mt-3 border-b border-border" />
      </div>

      {/* Desktop / tablet: wrapping pill row, no sideways scroll. */}
      <nav className="hidden sm:flex flex-wrap gap-1.5 border-b border-border pb-3">
        {links.map((l) => {
          const active = navActive(l.href, pathname);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                active
                  ? 'bg-brand/15 text-brand font-medium'
                  : 'text-fg-muted hover:bg-bg-elev hover:text-fg'
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

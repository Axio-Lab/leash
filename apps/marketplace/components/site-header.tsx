'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AuthButton } from '@/components/auth-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

/**
 * Public marketplace header used on the landing, browse, and listing
 * detail routes. Stays out of the creator dashboard, which has its own
 * sidebar chrome. Mobile collapses the inner nav into the auth pill.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : (pathname?.startsWith(href) ?? false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <LeashMark />
          <span className="hidden sm:inline">
            leash<span className="text-fg-muted">.market</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm md:flex">
          {[
            { href: '/browse', label: 'Browse' },
            { href: '/creator', label: 'Creators' },
            { href: '/creator/docs', label: 'Docs' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg',
                isActive(item.href) && 'bg-bg-elev text-fg',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden md:inline-flex">
            <Link href={NEXT_PUBLIC_AGENTS_URL}>Open agent dashboard →</Link>
          </Button>
          <AuthButton />
        </div>
      </div>
    </header>
  );
}

function LeashMark() {
  return (
    <span className="relative grid size-7 place-items-center rounded-md bg-gradient-to-br from-brand to-brand-strong text-white shadow-[0_4px_18px_-6px_oklch(0.7_0.22_290_/_0.6)]">
      <span className="text-[11px] font-bold tracking-tight">L</span>
    </span>
  );
}

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AuthButton } from '@/components/auth-button';
import { cn } from '@/lib/cn';
import { NEXT_PUBLIC_DOCS_URL } from '@/lib/env';

/**
 * Public marketplace header used on the landing, browse, and listing
 * detail routes. Stays out of the creator dashboard, which has its own
 * sidebar chrome. Mobile collapses the inner nav into the auth pill.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : (pathname?.startsWith(href) ?? false);
  const isBlog = pathname?.startsWith('/blog') ?? false;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-6 px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <Image
            src="/leash-logo.png"
            alt="Leash"
            width={22}
            height={22}
            className="[filter:brightness(0)_invert(1)] shrink-0"
            priority
          />
          <span className="whitespace-nowrap">
            leash<span className="text-fg-muted">.market</span>
          </span>
        </Link>
        {isBlog ? null : (
          <nav className="hidden items-center gap-1 text-sm md:flex">
            {[
              { href: '/browse', label: 'Browse', external: false },
              { href: '/blog', label: 'Blog', external: false },
              { href: '/creator', label: 'Creators', external: false },
              { href: NEXT_PUBLIC_DOCS_URL, label: 'Docs', external: true },
            ].map((item) =>
              item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md px-3 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    isActive(item.href) && 'bg-bg-elev text-fg',
                  )}
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">{isBlog ? null : <AuthButton />}</div>
      </div>
    </header>
  );
}

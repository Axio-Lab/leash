'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/settings', label: 'Overview' },
  { href: '/settings/connections', label: 'Connections' },
  { href: '/settings/favorites', label: 'Favorites' },
  { href: '/settings/skills', label: 'Skills' },
  { href: '/settings/spend', label: 'Spend' },
  { href: '/settings/llm', label: 'LLM keys' },
  { href: '/settings/api-keys', label: 'API keys' },
];

function navActive(href: string, pathname: string): boolean {
  if (href === '/settings') return pathname === '/settings';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-2 border-b border-border pb-3 overflow-x-auto scrollbar-thin -mx-1 px-1">
      {links.map((l) => {
        const active = navActive(l.href, pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`shrink-0 text-sm px-3 py-1.5 rounded-md transition-colors ${
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
  );
}

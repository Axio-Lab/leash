import Link from 'next/link';

import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-20">
      <div className="mx-auto flex flex-col gap-6 px-5 py-10 max-w-[1240px] md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <p className="font-semibold">
            leash<span className="text-fg-muted">.market</span>
          </p>
          <p className="text-xs text-fg-subtle max-w-sm">
            The open registry for agent tools. Stablecoin rails for autonomous agents.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-xs text-fg-muted md:grid-cols-3">
          <Link href="/browse" className="hover:text-fg">
            Browse tools
          </Link>
          <Link href="/creator" className="hover:text-fg">
            For creators
          </Link>
          <Link href="/creator/docs" className="hover:text-fg">
            Docs
          </Link>
          <Link href="/creator/list" className="hover:text-fg">
            List a tool
          </Link>
          <Link href="/creator/api-keys" className="hover:text-fg">
            API keys
          </Link>
          <a
            href={NEXT_PUBLIC_AGENTS_URL}
            className="hover:text-fg"
            target="_blank"
            rel="noreferrer"
          >
            Agent platform
          </a>
        </nav>
      </div>
    </footer>
  );
}

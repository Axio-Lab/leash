import Image from 'next/image';
import Link from 'next/link';
import { NetworkSwitch } from './network-switch';
import { SearchBar } from './search-bar';
import type { Network } from '@/lib/network';

/**
 * Top-of-page chrome. Mirrors apps/agents + apps/marketplace exactly:
 *  - White-inverted `leash-logo.png` (the same asset, hot-toned via
 *    `[filter:brightness(0)_invert(1)]`).
 *  - Lowercase `leash · explorer` wordmark with a muted tail accent.
 *  - Frosted-glass header that picks up the page's aurora background.
 */
export function Topbar({ network }: { network: Network }) {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-[--color-border] bg-[--color-bg]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
          aria-label="Leash Explorer — home"
        >
          <Image
            src="/leash-logo.png"
            alt="Leash"
            width={22}
            height={22}
            className="shrink-0 select-none [filter:brightness(0)_invert(1)]"
            priority
          />
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm">
              leash<span className="text-[--color-fg-muted]"> · explorer</span>
            </span>
            <span className="text-[10px] uppercase tracking-widest text-[--color-fg-subtle]">
              {network}
            </span>
          </span>
        </Link>
        <div className="flex-1">
          <SearchBar />
        </div>
        <div className="hidden md:block">
          <NetworkSwitch value={network} />
        </div>
      </div>
      <div className="block px-4 pb-3 sm:px-6 md:hidden">
        <NetworkSwitch value={network} />
      </div>
    </header>
  );
}

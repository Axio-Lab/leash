import Image from 'next/image';
import Link from 'next/link';
import { NetworkSwitch } from './network-switch';
import { SearchBar } from './search-bar';
import type { Network } from '@/lib/network';

export function Topbar({ network }: { network: Network }) {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-[--color-border] bg-[oklch(0.16_0.02_280_/_0.85)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[--color-brand-soft]">
            <Image
              src="/leash.svg"
              alt="Leash"
              width={62}
              height={62}
              className="h-full w-full object-contain p-0.5"
              priority
            />
          </span>
          <div className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-semibold">Leash Explorer</span>
            <span className="text-[10px] uppercase tracking-widest text-[--color-fg-subtle]">
              {network}
            </span>
          </div>
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

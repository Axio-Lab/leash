import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-[--color-border] py-6 text-xs text-[--color-fg-subtle]">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>
          leash<span className="text-[--color-fg-muted]"> · explorer</span> — powered by{' '}
          <Link
            href="https://api.leash.market"
            className="text-[--color-fg-muted] hover:text-[--color-fg]"
          >
            api.leash.market
          </Link>
        </span>
        <div className="flex gap-4">
          <Link href="https://docs.leash.market" className="hover:text-[--color-fg]">
            Docs
          </Link>
          <Link href="https://github.com/Axio-Lab/leash" className="hover:text-[--color-fg]">
            GitHub
          </Link>
          <Link href="/health" className="hover:text-[--color-fg]">
            Status
          </Link>
        </div>
      </div>
    </footer>
  );
}

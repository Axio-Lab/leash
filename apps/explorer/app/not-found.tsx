import Link from 'next/link';
import { getNetwork } from '@/lib/server-network';

export default async function NotFound() {
  const network = await getNetwork();
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-[--color-fg-subtle]">404</p>
      <h1 className="text-2xl font-semibold">Not found on {network}</h1>
      <p className="max-w-md text-sm text-[--color-fg-muted]">
        That address, transaction, or receipt does not exist on the {network} network. If it was
        produced on the other cluster, switch networks at the top right and try again.
      </p>
      <Link
        href="/"
        className="rounded-md border border-[--color-border] bg-[--color-bg-elev] px-4 py-2 text-sm hover:text-[--color-fg]"
      >
        ← Back to overview
      </Link>
    </div>
  );
}

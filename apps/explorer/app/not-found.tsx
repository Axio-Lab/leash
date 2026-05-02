import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getNetwork } from '@/lib/server-network';

export default async function NotFound() {
  const network = await getNetwork();
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.3em] text-[--color-fg-muted] backdrop-blur-md">
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Not found on {network}</h1>
      <p className="max-w-md text-sm leading-relaxed text-[--color-fg-muted]">
        That address, transaction, or receipt does not exist on the {network} network. If it was
        produced on the other cluster, switch networks at the top right and try again.
      </p>
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-4 py-1.5 text-xs text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:text-[--color-fg]"
      >
        <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
        Back to overview
      </Link>
    </div>
  );
}

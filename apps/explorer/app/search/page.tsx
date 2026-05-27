import { redirect } from 'next/navigation';
import { DbUnavailableError, resolveAgentMintByHandle } from '@/lib/db';
import { normalizeHandleSearch, resolveSearch, searchHitToHref } from '@/lib/search';
import { getNetwork } from '@/lib/server-network';
import { DbUnreachable, Empty } from '@/components/empty';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const network = await getNetwork();
  const q = sp.q ?? '';
  if (!q.trim()) {
    return (
      <Empty
        title="Type to search"
        description={`Agent handle, address, transaction signature, receipt hash, or event id (${network}).`}
      />
    );
  }
  const hit = resolveSearch(q);
  if (hit.kind !== 'unknown') {
    redirect(searchHitToHref(hit));
  }

  const handle = normalizeHandleSearch(q);
  if (handle) {
    let mint: string | null = null;
    try {
      mint = await resolveAgentMintByHandle(network, handle);
    } catch (err) {
      if (err instanceof DbUnavailableError) {
        return <DbUnreachable network={network} message={err.message} />;
      }
      throw err;
    }
    if (mint) redirect(`/agent/${encodeURIComponent(mint)}`);
  }

  return (
    <Empty
      title={`No match for "${q}".`}
      description="Search by agent handle, Solana pubkey, transaction signature, receipt hash (64 hex), or ULID event id."
    />
  );
}

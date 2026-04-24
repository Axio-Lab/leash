import { redirect } from 'next/navigation';
import { resolveSearch, searchHitToHref } from '@/lib/search';
import { getNetwork } from '@/lib/server-network';
import { Empty } from '@/components/empty';

type Props = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const network = await getNetwork();
  const q = sp.q ?? '';
  if (!q.trim()) {
    return (
      <Empty
        title="Type to search"
        description={`Address, transaction signature, receipt hash, or event id (${network}).`}
      />
    );
  }
  const hit = resolveSearch(q);
  if (hit.kind !== 'unknown') {
    redirect(searchHitToHref(hit));
  }
  return (
    <Empty
      title={`No syntactic match for "${q}".`}
      description="The query did not look like a Solana pubkey, transaction signature, receipt hash (64 hex), or ULID event id."
    />
  );
}

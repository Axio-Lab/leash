'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { AgentCreateChat } from '@/components/agent-create-chat';

export default function NewAgentPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create an agent</h1>
        <p className="text-fg-muted text-sm mt-1">
          A guided setup. Mint, fund, and launch in under a minute.
        </p>
      </div>
      <Suspense fallback={null}>
        <SearchAware />
      </Suspense>
    </div>
  );
}

function SearchAware() {
  const sp = useSearchParams();
  const slug = sp.get('add');
  return <AgentCreateChat initialAddSlug={slug} />;
}

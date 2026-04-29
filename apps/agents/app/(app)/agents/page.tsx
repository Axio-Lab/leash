'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { createThread, listThreads, setActiveUser } from '@/lib/chat-storage';

/** Redirects to newest thread or creates one — chat shell comes from layout. */
export default function AgentsChatIndexPage() {
  const { user, ready } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !user?.id) return;
    const pid = user.id;
    setActiveUser(pid);
    const threads = listThreads(pid);
    if (threads.length === 0) {
      const t = createThread(pid);
      router.replace(`/agents/${t.id}`);
      return;
    }
    router.replace(`/agents/${threads[0]!.id}`);
  }, [ready, user, router]);

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
      Opening chat…
    </div>
  );
}

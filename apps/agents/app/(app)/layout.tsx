'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { ChatShell } from '@/components/chat/chat-shell';
import { EnsureDefaultKey } from '@/components/ensure-default-key';
import { Spinner } from '@/components/ui/spinner';
import { NEXT_PUBLIC_PRIVY_APP_ID } from '@/lib/env';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-sm text-fg-muted px-6 text-center">
        Configure <code className="mx-1 text-brand">NEXT_PUBLIC_PRIVY_APP_ID</code> to enable login.
      </div>
    );
  }
  return <Inner>{children}</Inner>;
}

function Inner({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);

  const chatRoute = useMemo(() => {
    if (pathname === '/agents') return true;
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] !== 'agents' || parts.length !== 2) return false;
    const seg = parts[1]!;
    const reserved = new Set(['onboarding']);
    return !reserved.has(seg);
  }, [pathname]);

  if (!ready) return <FullPageSpinner />;
  if (!authenticated) return null;

  const uid = user?.id;
  if (!uid) return <FullPageSpinner />;

  const threadId = chatRoute
    ? pathname === '/agents'
      ? null
      : (pathname.split('/')[2] ?? null)
    : null;
  return (
    <ChatShell privyId={uid} activeThreadId={threadId} chatRoute={chatRoute}>
      <EnsureDefaultKey />
      {children}
    </ChatShell>
  );
}

function FullPageSpinner() {
  return (
    <div className="min-h-dvh flex items-center justify-center">
      <Spinner size="lg" brand />
    </div>
  );
}

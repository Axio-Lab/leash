'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { LogOutIcon, MessageSquareIcon, PlusIcon, SettingsIcon } from 'lucide-react';

import { createThread, deleteThread, listThreads, type ChatThread } from '@/lib/chat-storage';

export function ChatSidebar({
  privyId,
  activeThreadId,
  onLogout,
  onNavigate,
}: {
  privyId: string;
  activeThreadId: string | null;
  onLogout: () => void;
  /** Called after a navigation action on mobile so the drawer closes. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [threads, setThreads] = React.useState<ChatThread[]>([]);

  React.useEffect(() => {
    setThreads(listThreads(privyId));
  }, [privyId, activeThreadId]);

  function refresh() {
    setThreads(listThreads(privyId));
  }

  function onNewChat() {
    const t = createThread(privyId);
    refresh();
    router.push(`/agents/${t.id}`);
    onNavigate?.();
  }

  const chatActive = pathname?.startsWith('/agents') && !pathname?.startsWith('/agents/onboarding');

  return (
    <aside className="w-[260px] shrink-0 border-r border-border bg-bg-elev/95 flex flex-col h-full overflow-hidden">
      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-6">
        {/* Build group */}
        <div>
          <div className="px-3 pb-2 text-[10px] uppercase tracking-widest text-fg-subtle">
            Build
          </div>
          <ul className="space-y-0.5">
            <li>
              <Link
                href="/agents"
                onClick={onNavigate}
                className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  chatActive
                    ? 'bg-brand/15 text-fg shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
                    : 'text-fg-muted hover:bg-bg-elev hover:text-fg'
                }`}
              >
                <MessageSquareIcon
                  className={`size-4 transition-colors ${chatActive ? 'text-brand-strong' : 'text-fg-subtle group-hover:text-fg-muted'}`}
                />
                <span className="flex-1">Chat</span>
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={onNewChat}
                className="w-full text-left group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg"
              >
                <PlusIcon className="size-4 text-fg-subtle group-hover:text-fg-muted" />
                <span>New chat</span>
              </button>
            </li>
          </ul>
        </div>

        {/* Threads group */}
        {threads.length > 0 ? (
          <div>
            <div className="px-3 pb-2 text-[10px] uppercase tracking-widest text-fg-subtle">
              Threads
            </div>
            <ul className="space-y-0.5">
              {threads.map((t) => (
                <li key={t.id} className="group">
                  <div
                    className={`flex items-center gap-1 rounded-md ${
                      activeThreadId === t.id
                        ? 'bg-brand/15 shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
                        : 'hover:bg-bg-elev'
                    }`}
                  >
                    <Link
                      href={`/agents/${t.id}`}
                      onClick={onNavigate}
                      className="flex-1 min-w-0 px-3 py-2 text-left text-sm truncate text-fg-muted hover:text-fg"
                      title={t.title}
                    >
                      {t.title}
                    </Link>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 text-xs text-danger px-2 py-2 shrink-0"
                      aria-label="Delete thread"
                      onClick={(e) => {
                        e.preventDefault();
                        deleteThread(privyId, t.id);
                        refresh();
                        if (activeThreadId === t.id) router.push('/agents');
                      }}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-3 space-y-1">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
            pathname?.startsWith('/settings')
              ? 'bg-brand/15 text-fg shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
              : 'text-fg-muted hover:bg-bg-elev hover:text-fg'
          }`}
        >
          <SettingsIcon className="size-4 text-fg-subtle" />
          Settings
        </Link>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg text-left"
        >
          <LogOutIcon className="size-4 text-fg-subtle" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

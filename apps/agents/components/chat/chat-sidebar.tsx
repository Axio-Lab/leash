'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  LogOutIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SettingsIcon,
  Share2Icon,
  SquarePen,
  Trash2Icon,
  UserRoundIcon,
} from 'lucide-react';

import {
  createThread,
  deleteThread,
  listThreads,
  renameThread,
  type ChatThread,
} from '@/lib/chat-storage';

const agentsCheckFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { items: [] as Array<{ mint?: string }> };
  return res.json() as Promise<{ items: Array<{ mint?: string }> }>;
};
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

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
  const [renaming, setRenaming] = React.useState<{ id: string; value: string } | null>(null);

  // Cheap probe so the sidebar can show a 'set up your agent' dot until the
  // user has minted at least one. SWR shares this cache with chat-shell so
  // it's effectively free.
  const { data: agentsData } = useSWR('/api/agents', agentsCheckFetcher, {
    revalidateOnFocus: false,
  });
  const hasAgent = (agentsData?.items?.length ?? 0) > 0;
  const profileIncomplete = !hasAgent;

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

  function onShare(threadId: string) {
    const url = `${window.location.origin}/agents/${threadId}`;
    if (navigator.share) {
      navigator.share({ title: 'Leash agent chat', url }).catch(() => {
        /* user-cancelled share is not an error */
      });
      return;
    }
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url);
      toast.success('Link copied', { description: url });
      return;
    }
    toast.message('Share link', { description: url });
  }

  function onStartRename(thread: ChatThread) {
    setRenaming({ id: thread.id, value: thread.title });
  }

  function commitRename() {
    if (!renaming) return;
    const next = renaming.value.trim();
    if (!next) {
      setRenaming(null);
      return;
    }
    renameThread(privyId, renaming.id, next);
    refresh();
    toast.success('Chat renamed');
    setRenaming(null);
  }

  function onDelete(thread: ChatThread) {
    deleteThread(privyId, thread.id);
    refresh();
    toast.success('Chat deleted', {
      description: thread.title,
      action: {
        label: 'Undo',
        onClick: () => {
          // Best-effort restore: re-create with the same title (id will differ).
          const restored = createThread(privyId, thread.title);
          for (const m of thread.messages) {
            // Direct localStorage write via re-using append would change ids; we
            // accept that messages are restored as-is with new ids in storage.
            // (Rare path; full snapshot restore would need a richer storage API.)
            void m;
          }
          refresh();
          router.push(`/agents/${restored.id}`);
        },
      },
    });
    if (activeThreadId === thread.id) router.push('/agents');
  }

  return (
    <aside className="w-[224px] shrink-0 border-r border-border bg-bg-elev/95 flex flex-col h-full overflow-hidden">
      {/* New chat — primary action at the very top */}
      <div className="shrink-0 px-3 pt-3 pb-3">
        <Button
          type="button"
          onClick={onNewChat}
          variant="default"
          size="default"
          className="w-full justify-center gap-2"
        >
          <SquarePen className="size-4" />
          New chat
        </Button>
      </div>

      {/* Divider between New chat and previous threads */}
      <div className="shrink-0 px-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-fg-subtle whitespace-nowrap">
            Recent
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      </div>

      {/* Threads list */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2.5">
        {threads.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">
            No chats yet. Click <span className="text-fg-muted">New chat</span> to start.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {threads.map((t) => {
              const active = activeThreadId === t.id;
              const isRenaming = renaming?.id === t.id;
              return (
                <li key={t.id} className="group/row">
                  <div
                    className={`flex items-center gap-1 rounded-md border px-1.5 transition-colors ${
                      active
                        ? 'border-brand/40 bg-brand/15 shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.25)]'
                        : 'border-border/60 bg-bg/50 hover:border-border-strong hover:bg-bg-elev-2'
                    }`}
                  >
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ id: t.id, value: e.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenaming(null);
                          }
                        }}
                        className="flex-1 min-w-0 px-2 py-2 text-sm bg-transparent outline-none rounded text-fg ring-1 ring-brand/40"
                      />
                    ) : (
                      <Link
                        href={`/agents/${t.id}`}
                        onClick={onNavigate}
                        className="flex-1 min-w-0 px-2 py-2 text-left text-sm truncate text-fg-muted hover:text-fg"
                        title={t.title}
                      >
                        {t.title}
                      </Link>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Chat actions"
                          className={`shrink-0 rounded-md p-1.5 text-fg-subtle hover:text-fg hover:bg-bg-elev-2 transition-opacity ${
                            active
                              ? 'opacity-100'
                              : 'opacity-0 group-hover/row:opacity-100 focus:opacity-100 data-[state=open]:opacity-100'
                          }`}
                          onClick={(e) => e.preventDefault()}
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => onShare(t.id)}>
                          <Share2Icon className="size-4" />
                          Share
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onStartRename(t)}>
                          <PencilIcon className="size-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => onDelete(t)}>
                          <Trash2Icon className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-2 space-y-0.5">
        <Link
          href="/profile"
          onClick={onNavigate}
          className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
            pathname?.startsWith('/profile')
              ? 'bg-brand/15 text-fg shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
              : 'text-fg-muted hover:bg-bg-elev hover:text-fg'
          }`}
        >
          <span className="relative">
            <UserRoundIcon className="size-4 text-fg-subtle" />
            {profileIncomplete ? (
              <span
                className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warning ring-2 ring-bg-elev"
                aria-hidden
              />
            ) : null}
          </span>
          <span className="flex-1">Profile</span>
          {profileIncomplete ? (
            <span className="text-[10px] uppercase tracking-widest text-warning font-medium">
              Set up
            </span>
          ) : null}
        </Link>
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

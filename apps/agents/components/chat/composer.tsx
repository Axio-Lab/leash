'use client';

import * as React from 'react';
import { FileTextIcon, ImageIcon, PlusIcon, XIcon } from 'lucide-react';

import { ChatInput, ChatInputSubmit, ChatInputTextArea } from '@/components/ui/chat-input';
import { Button } from '@/components/ui/button';

export function Composer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (payload: ComposerPayload) => boolean | Promise<boolean>;
}) {
  const [value, setValue] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  async function send() {
    const t = value.trim();
    if (!t || pending || disabled) return;
    const payload: ComposerPayload = {
      text: t,
      attachments: attachments.map((a) => ({
        name: a.name,
        mime: a.file.type || 'application/octet-stream',
        size: a.file.size,
        file: a.file,
      })),
    };
    setPending(true);
    try {
      const ok = await onSend(payload);
      if (ok) {
        setValue('');
        setAttachments([]);
      }
    } finally {
      setPending(false);
    }
  }

  function onPickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list).slice(0, 5);
    const next = incoming.map((f) => normalizeAttachment(f));
    setAttachments((prev) => [...prev, ...next].slice(0, 8));
  }

  return (
    <div className="shrink-0 border-t border-border bg-bg/70 backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl px-3 sm:px-4 py-3 sm:py-4">
        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elev/60 px-2.5 py-1 text-[11px] text-fg-muted max-w-full"
                title={a.name}
              >
                {a.kind === 'image' ? (
                  <ImageIcon className="size-3" />
                ) : (
                  <FileTextIcon className="size-3" />
                )}
                <span className="truncate max-w-44">{a.name}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-bg-elev-2 text-fg-subtle hover:text-fg"
                  onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={`Remove ${a.name}`}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <ChatInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onSubmit={() => void send()}
          loading={pending}
          rows={1}
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 rounded-full p-0"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || pending}
            aria-label="Add files or photos"
          >
            <PlusIcon className="size-4" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,text/*,.md,.txt,.json,.csv,.ts,.tsx,.js,.jsx,.py,.rs,.sol"
            onChange={(e) => {
              void onPickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <ChatInputTextArea
            placeholder="Type a command or ask a question"
            disabled={disabled || pending}
          />
          <ChatInputSubmit />
        </ChatInput>
      </div>
    </div>
  );
}

type Attachment =
  | { kind: 'image'; name: string; size: number; file: File }
  | { kind: 'text'; name: string; size: number; file: File }
  | { kind: 'file'; name: string; size: number; file: File };

export type ComposerPayload = {
  text: string;
  attachments: Array<{ name: string; mime: string; size: number; file: File }>;
};

function normalizeAttachment(file: File): Attachment {
  if (file.type.startsWith('image/')) {
    return { kind: 'image', name: file.name, size: file.size, file };
  }
  if (
    file.type.startsWith('text/') ||
    /\.(md|txt|json|csv|ts|tsx|js|jsx|py|rs|sol)$/i.test(file.name)
  ) {
    return { kind: 'text', name: file.name, size: file.size, file };
  }
  return { kind: 'file', name: file.name, size: file.size, file };
}

'use client';

import * as React from 'react';
import { ArrowUpIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTextareaResize } from '@/hooks/use-textarea-resize';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';

interface ChatInputContextValue {
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  onSubmit?: () => void;
  loading?: boolean;
  onStop?: () => void;
  variant?: 'default' | 'unstyled';
  rows?: number;
}

const ChatInputContext = React.createContext<ChatInputContextValue>({});

interface ChatInputProps extends Omit<ChatInputContextValue, 'variant'> {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'unstyled';
  rows?: number;
}

export function ChatInput({
  children,
  className,
  variant = 'default',
  value,
  onChange,
  onSubmit,
  loading,
  onStop,
  rows = 1,
}: ChatInputProps) {
  return (
    <ChatInputContext.Provider
      value={{ value, onChange, onSubmit, loading, onStop, variant, rows }}
    >
      <div
        className={cn(
          variant === 'default' &&
            'flex w-full items-end gap-2 rounded-2xl border border-border bg-bg-elev/60 backdrop-blur-md p-2 transition-shadow focus-within:border-brand/60 focus-within:ring-[3px] focus-within:ring-brand/20',
          variant === 'unstyled' && 'flex w-full items-start gap-2',
          className,
        )}
      >
        {children}
      </div>
    </ChatInputContext.Provider>
  );
}
ChatInput.displayName = 'ChatInput';

interface ChatInputTextAreaProps extends React.ComponentProps<typeof Textarea> {
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  onSubmit?: () => void;
  variant?: 'default' | 'unstyled';
}

export function ChatInputTextArea({
  onSubmit: onSubmitProp,
  value: valueProp,
  onChange: onChangeProp,
  className,
  variant: variantProp,
  ...props
}: ChatInputTextAreaProps) {
  const ctx = React.useContext(ChatInputContext);
  const value = valueProp ?? ctx.value ?? '';
  const onChange = onChangeProp ?? ctx.onChange;
  const onSubmit = onSubmitProp ?? ctx.onSubmit;
  const rows = ctx.rows ?? 1;
  const variant = variantProp ?? (ctx.variant === 'default' ? 'unstyled' : 'default');

  const ref = useTextareaResize(value, rows);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!onSubmit) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      if (typeof value !== 'string' || value.trim().length === 0) return;
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      rows={rows}
      className={cn(
        'max-h-[112px] min-h-0 resize-none overflow-x-hidden overflow-y-auto bg-transparent scrollbar-thin',
        variant === 'unstyled' &&
          'border-none shadow-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-2.5 py-2',
        className,
      )}
      {...props}
    />
  );
}
ChatInputTextArea.displayName = 'ChatInputTextArea';

interface ChatInputSubmitProps extends React.ComponentProps<typeof Button> {
  onSubmit?: () => void;
  loading?: boolean;
  onStop?: () => void;
}

export function ChatInputSubmit({
  onSubmit: onSubmitProp,
  loading: loadingProp,
  onStop: onStopProp,
  className,
  ...props
}: ChatInputSubmitProps) {
  const ctx = React.useContext(ChatInputContext);
  const loading = loadingProp ?? ctx.loading;
  const onStop = onStopProp ?? ctx.onStop;
  const onSubmit = onSubmitProp ?? ctx.onSubmit;

  if (loading && onStop) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={onStop}
        className={cn('h-8 w-8 shrink-0 rounded-full p-0', className)}
        aria-label="Stop"
        {...props}
      >
        <span className="block size-3 rounded-[2px] bg-current" aria-hidden />
      </Button>
    );
  }

  if (loading) {
    return (
      <Button
        type="button"
        size="icon"
        disabled
        className={cn('h-8 w-8 shrink-0 rounded-full p-0', className)}
        aria-label="Sending"
        {...props}
      >
        <Spinner size="sm" />
      </Button>
    );
  }

  const isDisabled = typeof ctx.value !== 'string' || ctx.value.trim().length === 0;

  return (
    <Button
      type="button"
      size="icon"
      disabled={isDisabled}
      onClick={(e) => {
        e.preventDefault();
        if (!isDisabled) onSubmit?.();
      }}
      className={cn('h-8 w-8 shrink-0 rounded-full p-0', className)}
      aria-label="Send"
      {...props}
    >
      <ArrowUpIcon className="size-4" />
    </Button>
  );
}
ChatInputSubmit.displayName = 'ChatInputSubmit';

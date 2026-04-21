import * as React from 'react';
import { cn } from '@/lib/cn';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-border bg-bg-elev px-3 py-1 text-sm text-fg placeholder:text-fg-subtle',
        'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50 file:bg-transparent file:border-0 file:text-sm',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[120px] w-full rounded-md border border-border bg-bg-elev px-3 py-2 text-sm text-fg placeholder:text-fg-subtle font-mono',
      'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Input, Textarea };

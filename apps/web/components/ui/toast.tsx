'use client';

import * as React from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info';

type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastEntry = ToastInput & { id: string; variant: ToastVariant };

type ToastApi = {
  push(input: ToastInput): void;
  success(title: string, description?: string): void;
  error(title: string, description?: string): void;
  info(title: string, description?: string): void;
};

const ToastContext = React.createContext<ToastApi | null>(null);

function iconFor(variant: ToastVariant) {
  if (variant === 'success') return CheckCircle2;
  if (variant === 'error') return TriangleAlert;
  return Info;
}

function classesFor(variant: ToastVariant): string {
  if (variant === 'success') return 'border-success/40';
  if (variant === 'error') return 'border-danger/40';
  return 'border-border-strong';
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastEntry[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = React.useCallback(
    ({ title, description, variant = 'info', durationMs = 4200 }: ToastInput) => {
      const id = crypto.randomUUID();
      setItems((prev) => [...prev, { id, title, description, variant, durationMs }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastApi>(
    () => ({
      push,
      success: (title, description) => push({ title, description, variant: 'success' }),
      error: (title, description) => push({ title, description, variant: 'error' }),
      info: (title, description) => push({ title, description, variant: 'info' }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-100 flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2">
        {items.map((item) => {
          const Icon = iconFor(item.variant);
          return (
            <div
              key={item.id}
              className={`pointer-events-auto rounded-md border bg-bg-elev/95 p-3 shadow-xl backdrop-blur ${classesFor(item.variant)}`}
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{item.title}</p>
                  {item.description && (
                    <p className="mt-0.5 wrap-break-word text-xs leading-relaxed text-fg-subtle">
                      {item.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-fg-subtle hover:text-fg"
                  onClick={() => dismiss(item.id)}
                  aria-label="Dismiss notification"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

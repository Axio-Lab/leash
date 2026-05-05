'use client';

/**
 * Project-wide confirmation dialog.
 *
 * Why a custom component (vs `window.confirm`):
 *   - Native confirms freeze the event loop and look out of place against
 *     the rest of the app's chrome (dark theme, brand colour, copy that
 *     fits the action). They also can't render rich content like a
 *     warning callout or destructive-button styling.
 *   - Reuses the same overlay / panel chrome as `AddTelegramModal` and
 *     `AddWhatsAppModal` so confirmation dialogs feel like the rest of
 *     the External tab — no Dialog primitive ships in this app yet, and
 *     pulling in a fresh one for this single use isn't worth it.
 *
 * Usage:
 *
 *   const [open, setOpen] = React.useState(false);
 *   ...
 *   <ConfirmDialog
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     title="Delete connection?"
 *     description="..."
 *     confirmLabel="Delete connection"
 *     destructive
 *     onConfirm={async () => { await actuallyDelete(); }}
 *   />
 *
 * `onConfirm` may be sync or async; while it's pending the confirm
 * button shows a spinner and the dialog can't be dismissed.
 */

import * as React from 'react';
import { Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  // Esc closes — mirrors AddTelegramModal / AddWhatsAppModal which both
  // expose only the close button. We skip Esc while `busy` so a long
  // delete request can't be orphaned by the user accidentally hitting
  // a key.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-lg border border-border bg-bg-elev shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id="confirm-dialog-title" className="text-base font-medium">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1.5 text-fg-subtle hover:bg-bg hover:text-fg disabled:opacity-50"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {description ? <div className="px-4 py-4 text-sm text-fg-muted">{description}</div> : null}

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={busy}
            className={
              destructive
                ? 'bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger'
                : undefined
            }
          >
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

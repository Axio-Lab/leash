'use client';

import * as React from 'react';

export function ShowKeyOnceModal({
  plaintext,
  onClose,
}: {
  plaintext: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  if (!plaintext) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-lg border bg-bg-elev p-5 space-y-3">
        <div>
          <h2 className="text-base font-medium">Save this key now</h2>
          <p className="text-xs text-fg-muted mt-1">
            We'll never show the plaintext again. Store it somewhere safe.
          </p>
        </div>
        <pre className="rounded-md border bg-bg px-3 py-2 font-mono text-sm overflow-x-auto select-all">
          {plaintext}
        </pre>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(plaintext);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // Clipboard might be unavailable; user can still copy by hand.
              }
            }}
            className="rounded-md border px-3 py-1.5 text-sm hover:border-border-strong"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
          >
            I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}

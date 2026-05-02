'use client';

import * as React from 'react';
import { Check, Copy, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-xl border bg-bg-elev p-6 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="grid size-8 place-items-center rounded-md bg-amber-500/15 text-amber-300">
            <ShieldAlert className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Save this key now</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              We'll never show the plaintext again. Store it in a password manager or secret store.
            </p>
          </div>
        </div>
        <pre className="rounded-md border bg-bg p-3 font-mono text-sm overflow-x-auto select-all break-all">
          {plaintext}
        </pre>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(plaintext);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard might be unavailable */
              }
            }}
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-300" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="sm" onClick={onClose}>
            I've saved it
          </Button>
        </div>
      </div>
    </div>
  );
}

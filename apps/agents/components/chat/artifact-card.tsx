'use client';

import Link from 'next/link';

import type { ChatArtifact } from '@/lib/chat-storage';
import { agentUrl, receiptUrl, shortHash, txUrl } from '@/lib/explorer';

export function ArtifactCard({ artifact }: { artifact: ChatArtifact }) {
  if (artifact.kind === 'payment_link') {
    const p = artifact.payload as { url?: string; amount?: string; id?: string };
    return (
      <div className="rounded-lg border border-border bg-bg-elev p-3 text-sm space-y-1">
        <div className="text-xs font-medium text-fg-muted">Payment link</div>
        {p.amount ? <div className="text-fg">{p.amount} USDC</div> : null}
        {p.url ? (
          <Link
            href={p.url}
            className="text-brand text-xs break-all hover:underline"
            target="_blank"
          >
            {p.url}
          </Link>
        ) : null}
      </div>
    );
  }
  if (artifact.kind === 'receipt') {
    const p = artifact.payload as { hash?: string; tx?: string; mint?: string };
    return (
      <div className="rounded-lg border border-border bg-bg-elev p-3 text-sm space-y-1">
        <div className="text-xs font-medium text-fg-muted">Receipt</div>
        {p.hash ? (
          <Link href={receiptUrl(p.hash)} className="font-mono text-xs text-brand hover:underline">
            {shortHash(p.hash)}
          </Link>
        ) : null}
        {p.tx ? (
          <div>
            <Link href={txUrl(p.tx)} className="font-mono text-xs text-brand hover:underline">
              Tx {shortHash(p.tx)}
            </Link>
          </div>
        ) : null}
        {p.mint ? (
          <div>
            <Link href={agentUrl(p.mint)} className="font-mono text-xs text-brand hover:underline">
              Agent {shortHash(p.mint)}
            </Link>
          </div>
        ) : null}
      </div>
    );
  }
  const p = artifact.payload as { name?: string; input?: unknown };
  return (
    <div className="rounded-lg border border-border bg-bg-elev/80 p-3 text-xs font-mono text-fg-muted">
      <div className="text-fg font-sans font-medium text-[11px] mb-1">Tool</div>
      {p.name ?? 'call'}
      {p.input !== undefined ? (
        <pre className="mt-1 whitespace-pre-wrap break-all opacity-90">
          {typeof p.input === 'string' ? p.input : JSON.stringify(p.input, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

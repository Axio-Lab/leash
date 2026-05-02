'use client';

import Link from 'next/link';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy } from 'lucide-react';

import type { ChatArtifact } from '@/lib/chat-storage';
import { agentUrl, receiptUrl, shortHash, txUrl } from '@/lib/explorer';
import { Button } from '@/components/ui/button';
import { PayRequestArtifact, type PayRequestPayload } from '@/components/chat/pay-request-artifact';
import {
  WithdrawRequestArtifact,
  type WithdrawRequestPayload,
} from '@/components/chat/withdraw-request-artifact';

export function ArtifactCard({
  artifact,
  threadId,
}: {
  artifact: ChatArtifact;
  threadId?: string;
}) {
  if (artifact.kind === 'payment_link') {
    return <PaymentLinkArtifact payload={artifact.payload as PaymentLinkPayload} />;
  }
  if (artifact.kind === 'payment_request') {
    return (
      <PayRequestArtifact payload={artifact.payload as PayRequestPayload} threadId={threadId} />
    );
  }
  if (artifact.kind === 'withdraw_request') {
    return (
      <WithdrawRequestArtifact
        payload={artifact.payload as WithdrawRequestPayload}
        threadId={threadId}
      />
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

type PaymentLinkPayload = {
  url?: string;
  id?: string;
  amount?: string;
  currency?: string;
  label?: string;
  network?: string;
};

function PaymentLinkArtifact({ payload }: { payload: PaymentLinkPayload }) {
  const url = payload.url ?? '';
  const label = payload.label ?? 'Payment link';
  const network = payload.network;
  const priceLine = formatPriceLine(payload.amount, payload.currency);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-elev p-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-fg-muted">Payment link</div>
            <div className="text-fg font-medium truncate">{label}</div>
            {priceLine ? (
              <div className="text-xs text-fg-muted">
                {priceLine}
                {network ? <span className="ml-2 opacity-70">· {prettyNet(network)}</span> : null}
              </div>
            ) : null}
          </div>

          {url ? (
            <Link
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-mono text-[11px] text-brand break-all hover:underline"
            >
              {url}
            </Link>
          ) : null}

          <div className="flex items-center gap-1.5 pt-0.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={copy}
              disabled={!url}
              className="h-7 px-2 text-xs"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 mr-1" />
              ) : (
                <Copy className="h-3.5 w-3.5 mr-1" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>

        {url ? (
          <div className="shrink-0">
            <div className="rounded-md bg-white p-2">
              <QRCodeSVG
                value={url}
                size={104}
                bgColor="#ffffff"
                fgColor="#0a0a0a"
                level="M"
                marginSize={0}
              />
            </div>
            <div className="text-[10px] text-fg-muted text-center mt-1.5">Scan to pay</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The leash MCP tool returns `amount: "10 USDC"` and `currency: "USDC"`,
 * so naively rendering both gives "10 USDC USDC". Strip the currency
 * suffix from the amount when it's already there.
 */
function formatPriceLine(amount?: string, currency?: string): string {
  if (!amount) return '';
  const cur = currency?.trim();
  if (!cur) return amount.trim();
  const re = new RegExp(`\\s*${cur}\\s*$`, 'i');
  const stripped = amount.replace(re, '').trim();
  return `${stripped} ${cur}`;
}

function prettyNet(n: string): string {
  if (n === 'solana-devnet') return 'devnet';
  if (n === 'solana-mainnet') return 'mainnet';
  return n;
}

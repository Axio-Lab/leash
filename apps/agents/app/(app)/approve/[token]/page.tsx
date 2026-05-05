'use client';

/**
 * Deep-link approval landing page (`/approve/{token}`).
 *
 * Flow:
 *   1. Bot in Telegram (or WhatsApp) replies to a chat-initiated
 *      signing tool with a one-time link to this page.
 *   2. We GET the approval over `/api/external/approvals/{token}`
 *      (public proxy → public API endpoint). The payload tells us
 *      which artifact to render — payment_request, withdraw_request,
 *      etc — using the same components the in-app chat uses, so the
 *      UX is identical.
 *   3. The user signs with their existing Privy session. The artifact
 *      component fires `onSettled` with the receipt hash + tx sig once
 *      the on-chain transaction confirms.
 *   4. We POST `/api/external/approvals/{token}/consume` with the
 *      receipt; apps/api marks the row consumed, pushes a confirmation
 *      message to Telegram/WhatsApp (receipt + tx), and appends that
 *      line to the external-channel transcript so the next chat turn
 *      has context.
 *
 * If the user is not signed in we show a soft prompt to log in (the
 * artifact components require Privy anyway). If the token is unknown
 * / consumed / expired, we show the matching empty state — the
 * underlying secret is single-use, so the page must be idempotent
 * against accidental refreshes after settlement.
 */

import * as React from 'react';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { AlertTriangleIcon, CheckCircle2Icon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PayRequestArtifact } from '@/components/chat/pay-request-artifact';
import { WithdrawRequestArtifact } from '@/components/chat/withdraw-request-artifact';

type ApprovalRow = {
  token: string;
  connection_id: string;
  agent_mint: string;
  tool_name: string;
  payload: Record<string, unknown>;
  expires_at: string;
  consumed_at: string | null;
  result_receipt_hash: string | null;
  result_tx_sig: string | null;
  result_error: string | null;
  created_at: string;
};

const fetcher = async (url: string): Promise<ApprovalRow | { error: string }> => {
  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 404) return { error: 'not_found' };
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return (await res.json()) as ApprovalRow;
};

export default function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();

  const { data, error, isLoading, mutate } = useSWR(
    token ? `/api/external/approvals/${encodeURIComponent(token)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const [consuming, setConsuming] = React.useState(false);
  const [consumed, setConsumed] = React.useState(false);

  async function consume(body: Record<string, unknown>) {
    setConsuming(true);
    try {
      const res = await fetch(`/api/external/approvals/${encodeURIComponent(token)}/consume`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 410) {
        throw new Error(`HTTP ${res.status}`);
      }
      setConsumed(true);
      toast.success('Approval recorded', {
        description: 'A confirmation was sent to your chat.',
      });
      await mutate();
    } catch (err) {
      toast.error('Could not record approval', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setConsuming(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-start justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Approval needed</h1>
          <p className="text-xs text-fg-muted">
            Your bot asked you to confirm an action. Sign here with your Privy wallet — same wallet
            that runs the agent.
          </p>
        </div>

        {!ready ? (
          <Skeleton />
        ) : !authenticated ? (
          <SignedOutCta onLogin={() => login()} />
        ) : isLoading ? (
          <Skeleton />
        ) : error || !data ? (
          <ErrorBlock title="Could not load approval" detail={(error as Error)?.message} />
        ) : 'error' in data ? (
          <ErrorBlock
            title={
              data.error === 'not_found'
                ? 'Approval not found'
                : data.error === 'already_consumed'
                  ? 'Already used'
                  : 'Could not load approval'
            }
            detail={
              data.error === 'not_found'
                ? 'This link is unknown, expired, or already used. Ask your bot to mint a new one.'
                : data.error === 'already_consumed'
                  ? 'This approval has already been settled — refreshing the page is harmless.'
                  : data.error
            }
          />
        ) : data.consumed_at ? (
          <ConsumedBlock approval={data} />
        ) : (
          <>
            <ExpiryBanner expiresAt={data.expires_at} />
            <RouteToArtifact
              approval={data}
              onPaySettled={async (s) => {
                await consume({
                  receipt_hash: s.receipt_hash,
                  ...(s.tx_sig ? { tx_sig: s.tx_sig } : {}),
                });
              }}
              onWithdrawSettled={async (s) => {
                await consume({ tx_sig: s.tx_sig });
              }}
              onCancel={async () => {
                await consume({ error: 'cancelled by user' });
                router.push('/');
              }}
              consuming={consuming}
              consumed={consumed}
            />
          </>
        )}
      </div>
    </div>
  );
}

function RouteToArtifact({
  approval,
  onPaySettled,
  onWithdrawSettled,
  onCancel,
  consuming,
  consumed,
}: {
  approval: ApprovalRow;
  onPaySettled: (s: { tx_sig: string | null; receipt_hash: string }) => void | Promise<void>;
  onWithdrawSettled: (s: { tx_sig: string }) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  consuming: boolean;
  consumed: boolean;
}) {
  // The dispatcher writes the artifact's `kind` (payment_request /
  // withdraw_request / payment_link / receipt / tool_call) into
  // `tool_name` on the approval row when minting (see
  // telegram-dispatcher.ts → artifactKindToToolName). We translate
  // back here so the right card renders.
  const kind = artifactKindFromToolName(approval.tool_name);

  return (
    <div className="space-y-3">
      {kind === 'payment_request' ? (
        <PayRequestArtifact
          payload={approval.payload}
          onSettled={(s) => {
            void onPaySettled(s);
          }}
        />
      ) : kind === 'withdraw_request' ? (
        <WithdrawRequestArtifact
          payload={approval.payload}
          onSettled={(s) => {
            void onWithdrawSettled(s);
          }}
        />
      ) : (
        <UnsupportedKind kind={kind} />
      )}

      <div className="flex items-center justify-between text-[11px] text-fg-subtle">
        <span>
          {consuming ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" /> Recording approval…
            </span>
          ) : consumed ? (
            'Recorded — safe to close.'
          ) : (
            'After signing, this page will record the approval automatically.'
          )}
        </span>
        <button
          type="button"
          className="text-fg-muted hover:text-fg hover:underline"
          onClick={() => void onCancel()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ExpiryBanner({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  if (remaining <= 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          This approval has expired. Ask your bot to mint a new one — links are short-lived for
          safety.
        </span>
      </div>
    );
  }
  const min = Math.floor(remaining / 60_000);
  const sec = Math.floor((remaining % 60_000) / 1000);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg-elev px-3 py-1.5 text-[11px] text-fg-muted">
      <span className="size-1.5 rounded-full bg-warning" aria-hidden />
      Expires in {min > 0 ? `${min}m ` : ''}
      {sec}s
    </div>
  );
}

function ConsumedBlock({ approval }: { approval: ApprovalRow }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elev p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-brand" />
        <div className="space-y-1">
          <div className="text-sm font-medium">Approval already settled</div>
          {approval.result_tx_sig ? (
            <div className="font-mono text-[11px] text-fg-muted break-all">
              tx {approval.result_tx_sig}
            </div>
          ) : null}
          {approval.result_receipt_hash ? (
            <div className="font-mono text-[11px] text-fg-muted break-all">
              receipt {approval.result_receipt_hash}
            </div>
          ) : null}
          {approval.result_error ? (
            <div className="text-[11px] text-danger break-words">{approval.result_error}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SignedOutCta({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-elev p-4">
      <div className="text-sm font-medium">Sign in to approve</div>
      <p className="text-xs text-fg-muted">
        We need your Privy wallet to sign the on-chain action your bot is asking for. Same account
        you use in chat.
      </p>
      <Button type="button" size="sm" onClick={onLogin}>
        Sign in with Privy
      </Button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div className="h-24 animate-pulse rounded-lg border border-border bg-bg-elev/40" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-bg-elev/40" />
    </div>
  );
}

function ErrorBlock({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/8 p-4">
      <div className="flex items-start gap-2 text-sm text-danger">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">{title}</div>
          {detail ? <div className="mt-1 text-xs text-danger/80 break-words">{detail}</div> : null}
        </div>
      </div>
    </div>
  );
}

function UnsupportedKind({ kind }: { kind: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elev p-4 text-sm">
      <div className="font-medium">No browser action needed</div>
      <p className="mt-1 text-xs text-fg-muted">
        This approval ({kind}) doesn't require an on-chain signature here. You can close this tab.
      </p>
    </div>
  );
}

/**
 * Reverse of the dispatcher's `artifactKindToToolName`. The approval
 * row only stores `tool_name` (the underlying MCP tool the LLM
 * called); we map back to the artifact kind that drives which card
 * to render.
 */
function artifactKindFromToolName(toolName: string): string {
  switch (toolName) {
    case 'leash_pay_payment_link':
      return 'payment_request';
    case 'leash_withdraw_treasury':
      return 'withdraw_request';
    case 'leash_create_payment_link':
      return 'payment_link';
    case 'leash_get_receipt':
      return 'receipt';
    default:
      return 'tool_call';
  }
}

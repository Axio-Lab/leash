/**
 * Channel-agnostic dispatcher core.
 *
 * Both `dispatchTelegramMessage` and `dispatchWhatsAppMessage` go
 * through the same three steps:
 *
 *   1. Call apps/agents BFF (`POST /api/agents/run`) with the user's
 *      privy id, channel, and message text → `{text, artifacts}`.
 *   2. For every signing artifact, mint a one-time approval token and
 *      build a deep-link URL the user can sign with in their browser.
 *   3. Hand the assembled text + per-artifact approve URLs back to
 *      the channel-specific code, which knows how to format and send.
 *
 * Pulling steps 1+2 out of the channel files keeps WhatsApp from
 * duplicating ~80 LOC of identical agent-call + approval-mint
 * plumbing.
 */

import type { LeashApiConfig } from '../config.js';
import {
  createApproval,
  recordExternalMessage,
  touchConnectionLastSeen,
  type ExternalConnectionRow,
} from '../storage/external-connections.js';
import type { DbClient } from '../storage/turso.js';
import { ALWAYS_DEEP_LINK_KINDS, type ArtifactSummary } from './formatter.js';

export type AgentBffResponse = {
  text: string;
  artifacts: Array<{ kind: ArtifactSummary['kind']; payload: Record<string, unknown> }>;
  errors?: string[];
  warnings?: string[];
  agent_mint?: string | null;
  model?: string;
};

export type SharedRunResult =
  | {
      ok: true;
      bffResult: AgentBffResponse;
      summaries: ArtifactSummary[];
    }
  | {
      ok: false;
      reason: string;
      /**
       * Human-friendly fallback the channel can send back to the user
       * unchanged when the BFF can't be reached. Channels are expected
       * to send this verbatim (no markdown rendering).
       */
      userFacingError: string;
    };

export type RunSharedDeps = {
  config: LeashApiConfig;
  db: DbClient;
  bffFetch?: typeof fetch;
};

/**
 * Step 1+2 of the dispatch pipeline. The channel-specific caller does
 * step 3 (format + send) and persists the outbound audit row itself
 * (it knows the wire size of the formatted body).
 */
export async function runAgentForExternalChannel(
  deps: RunSharedDeps,
  args: { connection: ExternalConnectionRow; message: string },
): Promise<SharedRunResult> {
  const { config, db } = deps;
  const conn = args.connection;

  if (!config.agentsBffUrl || !config.agentsBffSecret) {
    return {
      ok: false,
      reason: 'agents_bff_not_configured',
      userFacingError:
        '\u26a0\ufe0f External chat is not fully configured (missing agents BFF). Ask the operator to set LEASH_AGENTS_BFF_URL.',
    };
  }

  await touchConnectionLastSeen(db, conn.id).catch(() => {});

  const fetchImpl = deps.bffFetch ?? globalThis.fetch;
  let bffResult: AgentBffResponse;
  try {
    const res = await fetchImpl(`${config.agentsBffUrl}/api/agents/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.agentsBffSecret}`,
      },
      body: JSON.stringify({
        owner_privy_id: conn.ownerPrivyId,
        channel: conn.channel,
        message: args.message,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        reason: `bff_${res.status}`,
        userFacingError: `\u26a0\ufe0f Couldn\u2019t reach the agent runtime (HTTP ${res.status}). Try again in a moment.`,
      };
    }
    bffResult = JSON.parse(text) as AgentBffResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return {
      ok: false,
      reason: `bff_unreachable: ${message}`,
      userFacingError: `\u26a0\ufe0f Couldn\u2019t reach the agent runtime: ${message}. Try again in a moment.`,
    };
  }

  const summaries: ArtifactSummary[] = [];
  for (const a of bffResult.artifacts) {
    const shouldDeepLink = needsDeepLink(a.kind, conn);
    let approveUrl: string | null = null;
    if (shouldDeepLink && bffResult.agent_mint) {
      try {
        const approval = await createApproval(db, {
          connectionId: conn.id,
          ownerPrivyId: conn.ownerPrivyId,
          agentMint: bffResult.agent_mint,
          toolName: artifactKindToToolName(a.kind),
          payload: a.payload,
        });
        approveUrl = `${config.publicOrigin}/approve/${approval.token}`;
        await recordExternalMessage(db, {
          connectionId: conn.id,
          direction: 'approval',
          payload: { token: approval.token, kind: a.kind },
        });
      } catch {
        approveUrl = null;
      }
    }
    summaries.push({ kind: a.kind, payload: a.payload, approveUrl });
  }

  return { ok: true, bffResult, summaries };
}

export function needsDeepLink(kind: ArtifactSummary['kind'], conn: ExternalConnectionRow): boolean {
  if (ALWAYS_DEEP_LINK_KINDS.has(kind)) return true;
  if (conn.signingMode === 'deep_link') return true;
  // Pattern C: 'delegated' will sign inline up to caps once the
  // inline-signer lands; for now we degrade to deep-link.
  return true;
}

export function artifactKindToToolName(kind: ArtifactSummary['kind']): string {
  switch (kind) {
    case 'payment_request':
      return 'leash_pay_payment_link';
    case 'withdraw_request':
      return 'leash_withdraw_treasury';
    case 'payment_link':
      return 'leash_create_payment_link';
    case 'receipt':
      return 'leash_get_receipt';
    case 'tool_call':
    default:
      return 'tool_call';
  }
}

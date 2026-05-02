/**
 * On-chain auth: verifies an `X-Leash-Sig` header signed by the agent's
 * executive ed25519 keypair.
 *
 * Why on-chain auth instead of API keys
 * -------------------------------------
 * Agents that come in via the standalone MCP server, the CLI, or any
 * third-party host generate their own ed25519 keypair locally on first
 * run. They don't have a Privy session, they don't have a service
 * key — they just have the keypair their `register_agent` call attached
 * to an MPL Core asset on chain.
 *
 * The natural auth model for those agents is "prove you control the
 * executive pubkey of asset X", which is exactly what an ed25519
 * signature over a canonical request envelope buys us. The verifier
 * doesn't need to know about Privy, doesn't need to issue a key, and
 * agents can move between hosts without re-onboarding.
 *
 * Canonical envelope
 * ------------------
 * Clients sign the SHA-256 of:
 *
 *   `${method}\n${pathWithQuery}\n${timestampIso}\n${sha256(bodyBytes)}\n${agentMint}`
 *
 * Headers:
 *   X-Leash-Agent      : the agent's MPL Core asset pubkey
 *   X-Leash-Timestamp  : ISO-8601 UTC; rejected if drift > 5min
 *   X-Leash-Sig        : base58 of the 64-byte ed25519 signature
 *
 * The middleware sets `c.set('agent_mint', mint)` so downstream handlers
 * can use `c.var.agent_mint` without re-parsing.
 *
 * NOTE for v0.1: the verifier resolves the executive pubkey from the
 * platform `agents` table (`owner_wallet` column, which is what
 * `/v1/agents/self-register` populates with the executive). Once we
 * land the v12 migration that adds a dedicated `executive_pubkey`
 * column for cross-interface portability we'll switch to that.
 */

import { createHash } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import type { Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

import type { LeashApiConfig } from '../config.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import type { DbClient } from '../storage/turso.js';
import { ApiError, unauthorized } from '../util/errors.js';

const SIG_HEADER = 'x-leash-sig';
const AGENT_HEADER = 'x-leash-agent';
const TIMESTAMP_HEADER = 'x-leash-timestamp';
const MAX_SKEW_MS = 5 * 60 * 1000;

export type OnChainAuthVariables = {
  agent_mint: string;
};

export type OnChainAuthDeps = {
  config: LeashApiConfig;
  db: DbClient;
};

/**
 * Build the canonical envelope hash that the client signs and the
 * server re-derives. Exported for SDK / test use.
 */
export function buildSigningEnvelope(args: {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  body: Uint8Array | string | undefined;
  agentMint: string;
}): Uint8Array {
  const bodyBytes =
    args.body == null
      ? new Uint8Array(0)
      : typeof args.body === 'string'
        ? new TextEncoder().encode(args.body)
        : args.body;
  const bodyHash = createHash('sha256').update(bodyBytes).digest('hex');
  const canonical = [
    args.method.toUpperCase(),
    args.pathWithQuery,
    args.timestamp,
    bodyHash,
    args.agentMint,
  ].join('\n');
  return new TextEncoder().encode(canonical);
}

let _verifyUmi: Umi | null = null;

/**
 * One Umi instance is enough for verification (we use the host RPC just
 * to satisfy the constructor; signature verification is local-only via
 * `umi.eddsa.verify`). Lazy + cached.
 */
function getVerifyUmi(rpcUrl: string): Umi {
  if (_verifyUmi) return _verifyUmi;
  _verifyUmi = createUmi(rpcUrl);
  return _verifyUmi;
}

/**
 * Verify the ed25519 signature attached to a request against the
 * agent's known executive pubkey. Returns the resolved agent mint.
 *
 * Throws `ApiError` (401) on every failure path so callers can let
 * the centralised error handler return a uniform JSON shape.
 */
export async function verifyOnChainSig(args: {
  config: LeashApiConfig;
  db: DbClient;
  method: string;
  pathWithQuery: string;
  body: Uint8Array | string | undefined;
  headers: Record<string, string | undefined>;
}): Promise<{ agentMint: string; executivePubkey: string }> {
  const { config, db, method, pathWithQuery, body, headers } = args;

  const sigB58 = headers[SIG_HEADER]?.trim();
  const agent = headers[AGENT_HEADER]?.trim();
  const ts = headers[TIMESTAMP_HEADER]?.trim();
  if (!sigB58 || !agent || !ts) {
    throw unauthorized(`missing one of: ${AGENT_HEADER}, ${TIMESTAMP_HEADER}, ${SIG_HEADER}`);
  }

  const tsMs = Date.parse(ts);
  if (!Number.isFinite(tsMs)) throw unauthorized(`invalid ${TIMESTAMP_HEADER}`);
  if (Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    throw unauthorized(`${TIMESTAMP_HEADER}: drift exceeds 5 minutes`);
  }

  const row = await getPlatformAgent(db, agent);
  if (!row) throw unauthorized(`unknown agent ${agent.slice(0, 8)}…`);
  if (row.status !== 'active') throw unauthorized('agent is disabled');
  // For agents minted via /v1/agents/self-register the executive is the
  // owner_wallet (the keypair the caller controls). Web-product agents
  // currently put a Privy embedded wallet here; once batch 8 lands the
  // dedicated executive_pubkey column we'll prefer that field.
  const executivePubkey = row.ownerWallet;

  let sigBytes: Uint8Array;
  try {
    sigBytes = base58.serialize(sigB58);
  } catch {
    throw unauthorized(`${SIG_HEADER}: not valid base58`);
  }
  if (sigBytes.length !== 64) throw unauthorized(`${SIG_HEADER}: expected 64 bytes`);

  const envelope = buildSigningEnvelope({
    method,
    pathWithQuery,
    timestamp: ts,
    body,
    agentMint: agent,
  });

  const umi = getVerifyUmi(config.rpc[row.network]);
  const ok = umi.eddsa.verify(envelope, sigBytes, publicKey(executivePubkey));
  if (!ok) throw unauthorized('signature does not verify');

  return { agentMint: agent, executivePubkey };
}

/**
 * Hono middleware that runs `verifyOnChainSig` against the incoming
 * request and stashes `agent_mint` on the context for downstream
 * handlers. Reads the body via `await c.req.arrayBuffer()` (the body
 * stream is already buffered by Hono so this is safe to call before the
 * route's body parser).
 */
export function onChainAuth<V extends OnChainAuthVariables = OnChainAuthVariables>(
  deps: OnChainAuthDeps,
): MiddlewareHandler<{ Variables: V }> {
  return async (c, next) => {
    const url = new URL(c.req.url);
    const buf = await c.req.arrayBuffer();
    const body = buf.byteLength === 0 ? undefined : new Uint8Array(buf);
    try {
      const { agentMint } = await verifyOnChainSig({
        config: deps.config,
        db: deps.db,
        method: c.req.method,
        pathWithQuery: url.pathname + (url.search || ''),
        body,
        headers: extractHeaders(c),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).set('agent_mint', agentMint);
      // Re-feed the body to downstream parsers. Hono v4 honours
      // `req.raw.bodyUsed` but our buffered re-read here is a no-op
      // for simple JSON routes that re-parse via `c.req.json()`.
      if (body) {
        c.req.raw = new Request(c.req.url, {
          method: c.req.method,
          headers: c.req.raw.headers,
          body,
        });
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw unauthorized((err as Error).message);
    }
    await next();
  };
}

function extractHeaders(c: Context): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  out[SIG_HEADER] = c.req.header(SIG_HEADER) ?? undefined;
  out[AGENT_HEADER] = c.req.header(AGENT_HEADER) ?? undefined;
  out[TIMESTAMP_HEADER] = c.req.header(TIMESTAMP_HEADER) ?? undefined;
  return out;
}

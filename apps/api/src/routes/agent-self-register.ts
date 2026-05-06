/**
 * Agent recording endpoint.
 *
 * The Leash protocol owns no keypairs and never auto-funds anyone.
 * Agent provisioning is fully client-side — the MCP / CLI / SDK
 * generate (or import) an executive keypair, the user funds it, and
 * the client mints the MPL Core asset + sets the unlimited-USDC
 * delegation locally. The API only records the resulting on-chain
 * artefact so the platform's agent feed, receipts, and webhooks
 * have something to key off.
 *
 * Endpoints
 * ---------
 *   POST /v1/agents/record
 *     Records a platform-side row for an MPL Core asset that has
 *     already been minted by the caller. Server reads the asset
 *     from RPC (read-only — no signer required), verifies the
 *     `owner === executive_pubkey`, then writes the platform row +
 *     issues a stub service key. Idempotent on `mint`. Works on
 *     both `solana-devnet` and `solana-mainnet`.
 *
 * Why a separate "record" step at all
 * -----------------------------------
 * MPL Core's Agent API requires `wallet === umi.identity` — the
 * executive must sign the mint tx, which means the server can never
 * mint on behalf of an arbitrary caller pubkey (the server has no
 * access to the caller's secret key). A faucet-mints-then-transfers
 * approach panics inside `mpl-core::transferV1` for agent assets
 * (the AgentIdentityV1 plugin layout trips an out-of-bounds read).
 *
 * So the canonical flow is "client mints → server records" —
 * implemented here. The previous `/v1/sandbox/agent` and
 * `/v1/faucet/drip-sol` endpoints (devnet-only YC-demo wedge) were
 * removed when the design moved to a single production-grade flow.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  fetchAssetV1,
  findAssetSignerPda,
  safeFetchAssetV1,
  type AssetV1,
} from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import { encryptSecret } from '@leashmarket/platform-auth/encryption';

import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { umiReadOnly } from '../util/umi.js';
import { createPlatformAgent, getPlatformAgent } from '../storage/platform-agents.js';
import { createApiKey } from '../storage/api-keys.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, rpcError } from '../util/errors.js';
import { type SvmNetwork } from '../util/network.js';

export type AgentSelfRegisterDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

const RegistrationV1Service = z
  .object({
    name: z.string().min(1).max(64),
    endpoint: z.string().url().max(500),
  })
  .openapi('RegistrationV1Service');

const RecordMintBody = z
  .object({
    mint: PubkeySchema.openapi({
      description: 'MPL Core asset address. Must already exist on the requested network.',
    }),
    executive_pubkey: PubkeySchema.openapi({
      description: 'Caller-controlled ed25519 pubkey that owns the asset.',
    }),
    name: z.string().min(1).max(120),
    description: z.string().max(2048).optional(),
    image_url: z.string().url().max(500).optional(),
    services: z.array(RegistrationV1Service).default([]),
    network: NetworkSchema.optional(),
  })
  .openapi('RecordMintBody');

const RecordMintResponse = z
  .object({
    mint: PubkeySchema,
    treasury: PubkeySchema,
    executive_pubkey: PubkeySchema,
    network: NetworkSchema,
    receipts_service: z.string().url(),
  })
  .openapi('RecordMintResponse');

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function recordPlatformRow(args: {
  deps: AgentSelfRegisterDeps;
  mint: string;
  treasury: string;
  executivePubkey: string;
  name: string;
  description: string;
  imageUrl: string;
  services: { name: string; endpoint: string }[];
  network: SvmNetwork;
  receiptsServiceUrl: string;
}): Promise<void> {
  const {
    deps,
    mint,
    treasury,
    executivePubkey,
    name,
    description,
    imageUrl,
    services,
    network,
    receiptsServiceUrl,
  } = args;
  const stubKey = await createApiKey(deps.db, {
    label: `agent:${mint.slice(0, 8)}:onchain`,
    network,
    ownerWallet: executivePubkey,
    scopes: ['agents'],
  });
  const encKey = deps.config.encryptionKey;
  const sealed = encKey
    ? encryptSecret('mcp-agent-no-llm-key-required-v1', encKey)
    : 'mcp-agent-no-llm-key-required-v1';
  await createPlatformAgent(deps.db, {
    mint,
    ownerPrivyId: `mcp:${executivePubkey}`,
    ownerWallet: executivePubkey,
    name,
    description: description || null,
    imageUrl: imageUrl || null,
    services: [
      ...services,
      ...(services.some((s) => s.name === 'receipts')
        ? []
        : [{ name: 'receipts', endpoint: receiptsServiceUrl }]),
    ],
    network,
    model: 'claude-sonnet-4',
    systemPrompt: 'You are an autonomous Leash agent driven via MCP. Be concise and helpful.',
    capabilities: [],
    budget: {
      perAction: '1.00',
      perTask: '5.00',
      perDay: '20.00',
    },
    treasury,
    serviceKeyId: stubKey.key.id,
    encryptedLlmKey: sealed,
    llmProvider: 'platform',
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────────

export function buildAgentSelfRegisterRoutes(deps: AgentSelfRegisterDeps): OpenAPIHono {
  const app = new OpenAPIHono();

  // ─────────────────────────────────────────────────────────
  // POST /v1/agents/record
  // ─────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/record',
      tags: ['agents'],
      summary: 'Record a platform row for an MPL Core agent already minted by the caller',
      description:
        'Server reads the asset from RPC (read-only), verifies the owner matches `executive_pubkey`, ' +
        'then writes the `agents` row + issues a stub service key. Idempotent on `mint`. ' +
        'The MCP / CLI / SDK call this after locally minting + delegating; no server-side keypairs ' +
        'are involved.',
      request: {
        body: { required: true, content: { 'application/json': { schema: RecordMintBody } } },
      },
      responses: {
        200: {
          description: 'recorded',
          content: { 'application/json': { schema: RecordMintResponse } },
        },
        409: {
          description: 'already recorded',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'invalid input or owner mismatch',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        502: { description: 'rpc', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network: SvmNetwork = body.network ?? 'solana-devnet';

      try {
        publicKey(body.mint);
        publicKey(body.executive_pubkey);
      } catch {
        throw invalidRequest('mint or executive_pubkey is not a valid Solana pubkey');
      }

      const existing = await getPlatformAgent(deps.db, body.mint).catch(() => null);
      if (existing) {
        throw invalidRequest(`agent ${body.mint} is already recorded`);
      }

      // Read-only Umi — no signer, no faucet, just an RPC URL. Works
      // identically for devnet + mainnet because all we do here is
      // `fetchAssetV1` + a PDA derivation (both are pure reads).
      const umi = umiReadOnly(deps.config, network);

      // RPC propagation between confirmation and account-read indexing
      // can take 1-6s on devnet (occasionally on mainnet too). Poll
      // until visible so the very-fresh-mint case doesn't 422 the
      // caller right after they confirmed locally.
      let asset: AssetV1 | null = null;
      const pollDeadline = Date.now() + 20_000;
      while (Date.now() < pollDeadline) {
        try {
          const found = await safeFetchAssetV1(umi, publicKey(body.mint));
          if (found) {
            asset = found;
            break;
          }
        } catch {
          // safeFetch returns null on missing-account, but treats other
          // errors as throws. We retry transient RPC blips up to the
          // deadline and surface a clean rpcError if we run out.
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      if (!asset) {
        try {
          asset = await fetchAssetV1(umi, publicKey(body.mint));
        } catch (err) {
          throw rpcError(`fetch asset failed after 20s: ${(err as Error).message}`);
        }
      }
      if (String(asset.owner) !== body.executive_pubkey) {
        throw invalidRequest(
          `asset owner is ${String(asset.owner)} (expected ${body.executive_pubkey}); ` +
            'transfer the asset to the executive before recording',
        );
      }

      const [treasuryPda] = findAssetSignerPda(umi, { asset: publicKey(body.mint) });
      const treasury = String(treasuryPda);
      const receiptsServiceUrl = `${deps.config.publicOrigin.replace(/\/+$/, '')}/v1/receipts/${body.mint}`;

      await recordPlatformRow({
        deps,
        mint: body.mint,
        treasury,
        executivePubkey: body.executive_pubkey,
        name: body.name,
        description: body.description ?? '',
        imageUrl: body.image_url ?? '',
        services: body.services,
        network,
        receiptsServiceUrl,
      });

      return c.json(
        {
          mint: body.mint,
          treasury,
          executive_pubkey: body.executive_pubkey,
          network,
          receipts_service: receiptsServiceUrl,
        },
        200,
      );
    },
  );

  return app;
}

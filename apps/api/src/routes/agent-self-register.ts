/**
 * Public agent-onboarding endpoints used by the standalone MCP server,
 * the CLI, and any third-party integrator that wants a Leash agent
 * without going through agent.leash.market's Privy flow.
 *
 * Endpoints
 * ---------
 *   GET  /v1/agents/self-register/info
 *     Health-check + faucet pubkey for clients that want to verify
 *     which wallet pays gas before they call /v1/faucet/drip-sol.
 *
 *   POST /v1/faucet/drip-sol           { destination, lamports? }
 *     Sends a small SOL drip from the server faucet to any pubkey.
 *     Used by first-run flows that need the caller's locally-generated
 *     ed25519 keypair to be funded enough to pay the mint fee
 *     (Metaplex Genesis API requires `wallet === umi.identity` —
 *     i.e. the executive must sign the mint, so it must have SOL).
 *     Capped at 0.05 SOL per call. Devnet-only.
 *
 *   POST /v1/agents/record             { mint, executive_pubkey, name, ... }
 *     Records a platform-side row for an MPL Core asset that has
 *     already been minted on chain by the caller. Server fetches the
 *     asset, verifies `owner === executive_pubkey`, then writes the
 *     `agents` row + issues a stub service key. Idempotent on `mint`.
 *
 *   POST /v1/sandbox/agent             { name?, description? }
 *     Devnet-only convenience: server generates an ed25519 keypair,
 *     drips SOL to it, mints an MPL Core agent with that key as
 *     payer + owner, drips USDC to the treasury, records the
 *     platform row, and returns the executive secret bytes ONCE.
 *     Designed for the YC demo: one call → working agent.
 *
 * Why a 3-endpoint shape instead of a single "self-register that mints"
 * --------------------------------------------------------------------
 * The Metaplex Agent API requires `wallet === umi.identity` — the
 * executive must sign the mint tx, which means the server can't mint
 * on behalf of an arbitrary caller pubkey (the server has no access
 * to the caller's secret key). A faucet-mints-then-transfers approach
 * panics inside `mpl-core::transferV1` for agent assets (the
 * AgentIdentityV1 plugin layout trips an out-of-bounds read).
 *
 * Splitting into "drip SOL → caller mints locally → record" keeps the
 * caller in control of their secret while the server provides the
 * one piece they can't (devnet SOL). Sandbox is the same flow with the
 * server playing both roles for the YC demo wedge.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  fetchAssetV1,
  findAssetSignerPda,
  safeFetchAssetV1,
  type AssetV1,
} from '@metaplex-foundation/mpl-core';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  type Keypair,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createAgent } from '@leash/registry-utils';
import { encryptSecret } from '@leash/platform-auth/encryption';

import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { fundExecutiveSol, fundTreasurySpl, getFaucetPubkey, getFaucetUmi } from '../lib/faucet.js';
import { createPlatformAgent, getPlatformAgent } from '../storage/platform-agents.js';
import { createApiKey } from '../storage/api-keys.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, rpcError } from '../util/errors.js';
import { solscanTxUrl, type SvmNetwork } from '../util/network.js';

export type AgentSelfRegisterDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

const DEFAULT_DRIP_LAMPORTS = 20_000_000n; // 0.02 SOL — enough for the mint tx + a couple of follow-ups.
const DRIP_LAMPORTS_CAP = 50_000_000n; // 0.05 SOL.
const SANDBOX_USDC_ATOMIC = 1_000_000n; // 1.00 USDC.
const SANDBOX_USDC_CAP = 5_000_000n; // 5.00 USDC.

const RegistrationV1Service = z
  .object({
    name: z.string().min(1).max(64),
    endpoint: z.string().url().max(500),
  })
  .openapi('RegistrationV1Service');

// ────────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────────

const DripSolBody = z
  .object({
    destination: PubkeySchema.openapi({
      description: 'Pubkey that should receive the SOL drip.',
    }),
    lamports: z
      .union([z.string(), z.number()])
      .optional()
      .openapi({
        description: `Amount in lamports. Defaults to ${String(DEFAULT_DRIP_LAMPORTS)} (0.02 SOL). Capped at ${String(DRIP_LAMPORTS_CAP)} per call.`,
      }),
    network: NetworkSchema.optional(),
  })
  .openapi('FaucetDripSolBody');

const DripSolResponse = z
  .object({
    destination: PubkeySchema,
    lamports: z.string(),
    signature: z.string(),
    network: NetworkSchema,
    explorer_url: z.string().url(),
  })
  .openapi('FaucetDripSolResponse');

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

const SandboxBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2048).optional(),
    fund_sol_lamports: z.union([z.string(), z.number()]).optional(),
    fund_usdc_atomic: z.union([z.string(), z.number()]).optional(),
  })
  .openapi('SandboxAgentBody');

const SandboxResponse = z
  .object({
    mint: PubkeySchema,
    treasury: PubkeySchema,
    executive_pubkey: PubkeySchema,
    executive_secret_base58: z.string(),
    network: NetworkSchema,
    tx_signatures: z.object({
      sol_drip: z.string(),
      mint: z.string(),
      usdc_drip: z.string(),
    }),
    explorer_urls: z.object({
      mint: z.string().url(),
      sol_drip: z.string().url(),
      usdc_drip: z.string().url(),
    }),
    funded: z.object({
      sol_lamports: z.string(),
      usdc_atomic: z.string(),
    }),
    receipts_service: z.string().url(),
  })
  .openapi('SandboxAgentResponse');

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function defaultName(executivePubkey: string): string {
  return `Agent ${executivePubkey.slice(0, 8)}`;
}

function clampBigint(input: unknown, defaultV: bigint, cap: bigint, fieldName: string): bigint {
  if (input == null) return defaultV;
  let v: bigint;
  try {
    v = BigInt(typeof input === 'number' ? Math.floor(input) : String(input));
  } catch {
    throw invalidRequest(`${fieldName} must be a non-negative integer`);
  }
  if (v < 0n) throw invalidRequest(`${fieldName} must be >= 0`);
  if (v > cap) throw invalidRequest(`${fieldName} exceeds cap (${String(cap)})`);
  return v;
}

function buildRegistrationDataUrl(input: {
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string }[];
  receiptsTemplate: string;
}): string {
  const callerHasReceipts = input.services.some((s) => s.name === 'receipts');
  const services = callerHasReceipts
    ? input.services
    : [...input.services, { name: 'receipts', endpoint: input.receiptsTemplate }];
  const doc = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1' as const,
    name: input.name,
    description: input.description,
    image: input.image,
    services,
    x402Support: true,
    active: true,
    registrations: [],
    supportedTrust: [],
  };
  return `data:application/json;utf8,${encodeURIComponent(JSON.stringify(doc))}`;
}

/** Build a Umi instance whose identity is the supplied keypair, for sandbox flows. */
function buildUmiWith(rpcUrl: string, kp: Keypair): Umi {
  const umi = createUmi(rpcUrl).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(kp));
  return umi;
}

/**
 * Once a destination has been credited with SOL by the faucet, the
 * underlying RPC may still not see the new lamports for ~1-3s. We
 * poll the account until the balance >= expected before letting
 * callers proceed (mint will fail with "insufficient funds" if we
 * don't wait).
 */
async function waitForLamports(args: {
  umi: Umi;
  account: string;
  minLamports: bigint;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = args.timeoutMs ?? 20_000;
  const intervalMs = 750;
  const started = Date.now();
  while (true) {
    const acct = await args.umi.rpc.getAccount(publicKey(args.account));
    if (acct.exists && BigInt(acct.lamports.basisPoints) >= args.minLamports) return;
    if (Date.now() - started > timeoutMs) {
      throw rpcError(
        `account ${args.account} did not reach ${String(args.minLamports)} lamports within ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

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
  // GET /v1/agents/self-register/info
  // ─────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agents/self-register/info',
      tags: ['agents'],
      summary: 'Faucet metadata for self-register / sandbox endpoints',
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({
                faucet_pubkey: PubkeySchema,
                supported_networks: z.array(NetworkSchema),
                drip_sol_default_lamports: z.string(),
                drip_sol_cap_lamports: z.string(),
                sandbox: z.object({
                  default_usdc_atomic: z.string(),
                  cap_usdc_atomic: z.string(),
                }),
              }),
            },
          },
        },
        503: {
          description: 'faucet not configured',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const faucetPubkey = getFaucetPubkey(deps.config, 'solana-devnet');
      return c.json(
        {
          faucet_pubkey: faucetPubkey,
          supported_networks: ['solana-devnet'] as ('solana-devnet' | 'solana-mainnet')[],
          drip_sol_default_lamports: String(DEFAULT_DRIP_LAMPORTS),
          drip_sol_cap_lamports: String(DRIP_LAMPORTS_CAP),
          sandbox: {
            default_usdc_atomic: String(SANDBOX_USDC_ATOMIC),
            cap_usdc_atomic: String(SANDBOX_USDC_CAP),
          },
        },
        200,
      );
    },
  );

  // ─────────────────────────────────────────────────────────
  // POST /v1/faucet/drip-sol
  // ─────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/faucet/drip-sol',
      tags: ['agents'],
      summary: 'Send a small SOL drip from the server faucet (devnet)',
      description:
        'Used by first-run agent flows that need the caller-supplied executive ' +
        'pubkey funded so it can pay its own mint tx fee. Capped per call.',
      request: {
        body: { required: true, content: { 'application/json': { schema: DripSolBody } } },
      },
      responses: {
        200: {
          description: 'sent',
          content: { 'application/json': { schema: DripSolResponse } },
        },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        502: { description: 'rpc', content: { 'application/json': { schema: ApiErrorSchema } } },
        503: {
          description: 'faucet not configured',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network: SvmNetwork = body.network ?? 'solana-devnet';
      if (network !== 'solana-devnet') throw invalidRequest('drip-sol is devnet-only in v0.1');
      const lamports = clampBigint(
        body.lamports,
        DEFAULT_DRIP_LAMPORTS,
        DRIP_LAMPORTS_CAP,
        'lamports',
      );
      try {
        publicKey(body.destination);
      } catch {
        throw invalidRequest('destination is not a valid Solana pubkey');
      }
      const umi = getFaucetUmi(deps.config, network);
      let signature: string;
      try {
        signature = await fundExecutiveSol({ umi, destination: body.destination, lamports });
      } catch (err) {
        throw rpcError(`drip-sol failed: ${(err as Error).message}`);
      }
      return c.json(
        {
          destination: body.destination,
          lamports: String(lamports),
          signature,
          network,
          explorer_url: solscanTxUrl(network, signature),
        },
        200,
      );
    },
  );

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
        'Server fetches the asset, verifies the owner matches `executive_pubkey`, then writes the ' +
        '`agents` row + issues a stub service key. Idempotent on `mint`.',
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
        503: {
          description: 'faucet not configured',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network: SvmNetwork = body.network ?? 'solana-devnet';
      if (network !== 'solana-devnet') throw invalidRequest('record is devnet-only in v0.1');

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

      const umi = getFaucetUmi(deps.config, network);
      // RPC propagation between confirmation and account-read indexing can
      // take 1–6s on devnet. Poll until visible.
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
        // One last unconditional read so the error message includes whatever
        // detail the SDK surfaces on definitive failures.
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

  // ─────────────────────────────────────────────────────────
  // POST /v1/sandbox/agent
  // ─────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/sandbox/agent',
      tags: ['agents'],
      summary: 'Generate + fund + mint a fresh devnet agent in one round-trip',
      description:
        'Devnet-only YC-demo wedge: server generates an ed25519 keypair, drips SOL to it, mints ' +
        'an MPL Core agent with that keypair as payer + owner, drips USDC to the treasury, records ' +
        'the platform row, and returns the secret bytes ONCE.',
      request: {
        body: { required: false, content: { 'application/json': { schema: SandboxBody } } },
      },
      responses: {
        200: {
          description: 'sandbox agent provisioned',
          content: { 'application/json': { schema: SandboxResponse } },
        },
        422: {
          description: 'invalid input',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        502: {
          description: 'rpc error during one of the on-chain steps',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        503: {
          description: 'faucet not configured',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const body = SandboxBody.parse(raw);
      const network: SvmNetwork = 'solana-devnet';

      const solDripLamports = clampBigint(
        body.fund_sol_lamports,
        DEFAULT_DRIP_LAMPORTS,
        DRIP_LAMPORTS_CAP,
        'fund_sol_lamports',
      );
      const usdcDripAtomic = clampBigint(
        body.fund_usdc_atomic,
        SANDBOX_USDC_ATOMIC,
        SANDBOX_USDC_CAP,
        'fund_usdc_atomic',
      );

      const faucetUmi = getFaucetUmi(deps.config, network);
      const fresh = generateSigner(faucetUmi);
      const executivePubkey = String(fresh.publicKey);
      const executiveSecret = base58.deserialize(fresh.secretKey)[0];

      const name = (body.name ?? '').trim() || defaultName(executivePubkey);
      const description = body.description ?? 'Sandbox agent provisioned by /v1/sandbox/agent';

      // 1. Drip SOL → executive
      let solDripSig: string;
      try {
        solDripSig = await fundExecutiveSol({
          umi: faucetUmi,
          destination: executivePubkey,
          lamports: solDripLamports,
        });
      } catch (err) {
        throw rpcError(`SOL drip to executive failed: ${(err as Error).message}`);
      }

      // 2. Wait for lamports to land before minting (RPC propagation race).
      try {
        await waitForLamports({
          umi: faucetUmi,
          account: executivePubkey,
          minLamports: solDripLamports,
        });
      } catch (err) {
        throw rpcError(`SOL drip not visible: ${(err as Error).message}`);
      }

      // 3. Mint agent — executive pays + owns.
      const executiveKp: Keypair = {
        publicKey: fresh.publicKey,
        secretKey: fresh.secretKey,
      };
      const executiveUmi = buildUmiWith(deps.config.rpc[network], executiveKp);
      const receiptsTemplate = `${deps.config.publicOrigin.replace(/\/+$/, '')}/v1/receipts/{agent}`;
      const uri = buildRegistrationDataUrl({
        name,
        description,
        image: '',
        services: [],
        receiptsTemplate,
      });
      let mintSig: string;
      let mint: string;
      try {
        const result = await createAgent(executiveUmi, {
          wallet: executivePubkey,
          name,
          uri,
          description,
          network,
          services: [],
        });
        mintSig = result.signature;
        mint = result.assetAddress;
      } catch (err) {
        throw rpcError(`mintAndSubmitAgent failed: ${(err as Error).message}`);
      }

      const [treasuryPda] = findAssetSignerPda(executiveUmi, { asset: publicKey(mint) });
      const treasury = String(treasuryPda);

      // 4. Drip USDC → treasury.
      let usdcDripSig = '';
      if (usdcDripAtomic > 0n) {
        try {
          usdcDripSig = await fundTreasurySpl({
            umi: faucetUmi,
            treasuryPda: treasury,
            symbol: 'USDC',
            amountAtomic: usdcDripAtomic,
          });
        } catch (err) {
          throw rpcError(
            `USDC drip to treasury failed (agent ${mint} is minted but unfunded for USDC): ${(err as Error).message}`,
          );
        }
      }

      // 5. Record platform row.
      const receiptsServiceUrl = `${deps.config.publicOrigin.replace(/\/+$/, '')}/v1/receipts/${mint}`;
      await recordPlatformRow({
        deps,
        mint,
        treasury,
        executivePubkey,
        name,
        description,
        imageUrl: '',
        services: [],
        network,
        receiptsServiceUrl,
      });

      return c.json(
        {
          mint,
          treasury,
          executive_pubkey: executivePubkey,
          executive_secret_base58: executiveSecret,
          network,
          tx_signatures: {
            sol_drip: solDripSig,
            mint: mintSig,
            usdc_drip: usdcDripSig,
          },
          explorer_urls: {
            mint: solscanTxUrl(network, mintSig),
            sol_drip: solscanTxUrl(network, solDripSig),
            usdc_drip: usdcDripSig ? solscanTxUrl(network, usdcDripSig) : '',
          },
          funded: {
            sol_lamports: String(solDripLamports),
            usdc_atomic: String(usdcDripAtomic),
          },
          receipts_service: receiptsServiceUrl,
        },
        200,
      );
    },
  );

  return app;
}

/**
 * Public/native-subscription read model routes.
 *
 * These are separate from the API-key prepare routes:
 *   - public GETs serve hosted metadata and Explorer detail data.
 *   - agent-signed POST lets standalone MCP/CLI report direct native
 *     subscription transactions after it has signed them locally.
 */

import { OpenAPIHono, z } from '@hono/zod-openapi';

import { onChainAuth, type OnChainAuthVariables } from '../auth/onchain.js';
import { type LeashApiConfig } from '../config.js';
import { PubkeySchema, TokenProgramFlavorSchema } from '../openapi/common.js';
import { ingestChainEvent, type EventKind } from '../storage/events.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import type { DbClient } from '../storage/turso.js';
import {
  buildNativePlanMetadata,
  getNativeSubscription,
  getNativeSubscriptionPlan,
  type NativeSubscriptionPlanRow,
  type NativeSubscriptionRow,
  nativePlanExplorerUrl,
  nativePlanMetadataUri,
  updateNativeSubscriptionPlanRecord,
  updateNativeSubscriptionStatus,
  upsertNativeSubscription,
  upsertNativeSubscriptionPlan,
} from '../storage/native-subscriptions.js';
import { invalidRequest, notFound, unauthorized } from '../util/errors.js';
import { isSvmNetwork, type SvmNetwork } from '../util/network.js';

type Deps = { config: LeashApiConfig; db: DbClient };

const NativeNetworkQuery = z.object({
  network: z.enum(['solana-devnet', 'solana-mainnet']).default('solana-devnet'),
});

const NativeKindSchema = z.enum([
  'native.subscription_authority.init',
  'native.subscription_authority.close',
  'native.allowance.fixed.create',
  'native.allowance.fixed.transfer',
  'native.allowance.fixed.revoke',
  'native.allowance.recurring.create',
  'native.allowance.recurring.transfer',
  'native.allowance.recurring.revoke',
  'native.subscription_plan.create',
  'native.subscription_plan.update',
  'native.subscription.subscribe',
  'native.subscription.cancel',
  'native.subscription.resume',
  'native.subscription.revoke',
  'native.subscription.collect',
] as const);

const AgentNativeEventBody = z.object({
  kind: NativeKindSchema,
  signature: z.string().min(32).max(128),
  plan: PubkeySchema.optional(),
  subscription: PubkeySchema.optional(),
  merchant_wallet: PubkeySchema.optional(),
  subscriber_wallet: PubkeySchema.optional(),
  plan_id: z.string().regex(/^\d+$/).optional(),
  spl_mint: PubkeySchema.optional(),
  token_program: z.union([TokenProgramFlavorSchema, PubkeySchema]).optional(),
  symbol: z.enum(['USDC', 'USDT', 'USDG']).optional(),
  amount_atomic: z.string().regex(/^\d+$/).optional(),
  amount: z.string().optional(),
  period_hours: z.string().regex(/^\d+$/).optional(),
  status: z.enum(['active', 'sunset', 'cancelled', 'revoked']).optional(),
  metadata_uri: z.string().max(256).optional(),
  metadata: z.record(z.unknown()).optional(),
  event_metadata: z.record(z.unknown()).optional(),
});

export function buildNativeSubscriptionRecordRoutes(deps: Deps): OpenAPIHono<{
  Variables: OnChainAuthVariables;
}> {
  const app = new OpenAPIHono<{ Variables: OnChainAuthVariables }>();

  app.get('/v1/subscription-plans/:plan', async (c) => {
    const plan = c.req.param('plan');
    const { network } = NativeNetworkQuery.parse(c.req.query());
    const row = await getNativeSubscriptionPlan(deps.db, network, plan);
    if (!row) throw notFound('native subscription plan not found');
    return c.json(planToWire(row), 200);
  });

  app.get('/v1/subscription-plans/:plan/metadata', async (c) => {
    const plan = c.req.param('plan');
    const { network } = NativeNetworkQuery.parse(c.req.query());
    const row = await getNativeSubscriptionPlan(deps.db, network, plan);
    if (!row) throw notFound('native subscription plan metadata not found');
    return c.json(row.metadata, 200);
  });

  app.get('/v1/subscriptions/:subscription', async (c) => {
    const subscription = c.req.param('subscription');
    const { network } = NativeNetworkQuery.parse(c.req.query());
    const row = await getNativeSubscription(deps.db, network, subscription);
    if (!row) throw notFound('native subscription not found');
    return c.json(subscriptionToWire(row), 200);
  });

  app.use('/v1/agents/:mint/native-subscriptions/events', onChainAuth(deps));
  app.post('/v1/agents/:mint/native-subscriptions/events', async (c) => {
    const mint = c.req.param('mint');
    if (mint !== c.var.agent_mint) throw unauthorized('X-Leash-Agent must equal :mint path param');
    const agent = await getPlatformAgent(deps.db, mint);
    if (!agent) throw notFound('agent not found');
    if (!isSvmNetwork(agent.network)) throw invalidRequest('agent has invalid network');

    const body = AgentNativeEventBody.parse(await c.req.json());
    const eventMetadata = {
      rail: 'native_subscription',
      ...(body.event_metadata ?? {}),
      ...(body.plan ? { plan: body.plan } : {}),
      ...(body.subscription ? { subscription: body.subscription } : {}),
      ...(body.merchant_wallet ? { merchant: body.merchant_wallet } : {}),
      ...(body.subscriber_wallet ? { subscriber: body.subscriber_wallet } : {}),
      ...(body.plan_id ? { plan_id: body.plan_id } : {}),
      ...(body.metadata_uri ? { metadata_uri: body.metadata_uri } : {}),
      ...(body.symbol ? { symbol: body.symbol } : {}),
    };
    const event = await ingestChainEvent(deps.db, {
      kind: body.kind as EventKind,
      network: agent.network,
      signature: body.signature,
      agentAsset: mint,
      mint: body.spl_mint ?? null,
      amountAtomic: body.amount_atomic ?? null,
      metadata: eventMetadata,
      source: 'mcp',
    });

    if (body.kind === 'native.subscription_plan.create') {
      if (
        !body.plan ||
        !body.merchant_wallet ||
        !body.plan_id ||
        !body.spl_mint ||
        !body.token_program ||
        !body.amount_atomic ||
        !body.period_hours
      ) {
        throw invalidRequest('plan create event is missing plan fields');
      }
      const metadataUri =
        body.metadata_uri ??
        nativePlanMetadataUri({
          apiOrigin: deps.config.publicOrigin,
          network: agent.network,
          plan: body.plan,
        });
      const metadata =
        body.metadata ??
        buildNativePlanMetadata({
          name: null,
          amount: body.amount ?? body.amount_atomic,
          amountAtomic: body.amount_atomic,
          currency: body.symbol ?? 'USDC',
          mint: body.spl_mint,
          periodHours: body.period_hours,
          merchantAgent: mint,
          merchantWallet: body.merchant_wallet,
          plan: body.plan,
          planId: body.plan_id,
          network: agent.network,
          explorerUrl: nativePlanExplorerUrl({
            explorerOrigin: deps.config.explorerPublicOrigin,
            plan: body.plan,
            network: agent.network,
          }),
        });
      await upsertNativeSubscriptionPlan(deps.db, {
        network: agent.network,
        plan: body.plan,
        agentMint: mint,
        merchantWallet: body.merchant_wallet,
        planId: body.plan_id,
        mint: body.spl_mint,
        tokenProgram: body.token_program,
        symbol: body.symbol ?? null,
        amountAtomic: body.amount_atomic,
        periodHours: body.period_hours,
        status: body.status === 'sunset' ? 'sunset' : 'active',
        metadataUri,
        metadata,
        createTxSig: body.signature,
        lastEventId: event.eventId,
      });
    } else if (body.kind === 'native.subscription_plan.update' && body.plan) {
      await updateNativeSubscriptionPlanRecord(deps.db, {
        network: agent.network,
        plan: body.plan,
        status: body.status === 'sunset' ? 'sunset' : body.status === 'active' ? 'active' : null,
        metadataUri: body.metadata_uri ?? null,
        metadata: body.metadata ?? null,
        updateTxSig: body.signature,
        lastEventId: event.eventId,
      });
    } else if (body.kind === 'native.subscription.subscribe') {
      if (!body.plan || !body.subscription || !body.subscriber_wallet) {
        throw invalidRequest('subscribe event is missing subscription fields');
      }
      await upsertNativeSubscription(deps.db, {
        network: agent.network,
        subscription: body.subscription,
        plan: body.plan,
        agentMint: mint,
        subscriberWallet: body.subscriber_wallet,
        mint: body.spl_mint ?? null,
        status: 'active',
        subscribeTxSig: body.signature,
        lastTxSig: body.signature,
        lastEventId: event.eventId,
      });
    } else if (
      body.subscription &&
      (body.kind === 'native.subscription.cancel' ||
        body.kind === 'native.subscription.resume' ||
        body.kind === 'native.subscription.revoke')
    ) {
      await updateNativeSubscriptionStatus(deps.db, {
        network: agent.network,
        subscription: body.subscription,
        status:
          body.kind === 'native.subscription.revoke'
            ? 'revoked'
            : body.kind === 'native.subscription.cancel'
              ? 'cancelled'
              : 'active',
        lastTxSig: body.signature,
        lastEventId: event.eventId,
      });
    }

    return c.json(
      {
        kind: 'native_subscription_event',
        status: 'ok',
        network: agent.network,
        event_id: event.eventId,
        duplicate: event.duplicate,
      },
      200,
    );
  });

  return app;
}

function planToWire(row: NativeSubscriptionPlanRow) {
  return {
    kind: 'native_subscription_plan',
    status: 'ok',
    network: row.network,
    plan: row.plan,
    agent_mint: row.agentMint,
    merchant_wallet: row.merchantWallet,
    plan_id: row.planId,
    mint: row.mint,
    token_program: row.tokenProgram,
    symbol: row.symbol,
    amount_atomic: row.amountAtomic,
    period_hours: row.periodHours,
    plan_status: row.status,
    metadata_uri: row.metadataUri,
    metadata: row.metadata,
    create_tx_sig: row.createTxSig,
    update_tx_sig: row.updateTxSig,
    last_event_id: row.lastEventId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function subscriptionToWire(row: NativeSubscriptionRow) {
  return {
    kind: 'native_subscription',
    status: 'ok',
    network: row.network,
    subscription: row.subscription,
    plan: row.plan,
    agent_mint: row.agentMint,
    subscriber_wallet: row.subscriberWallet,
    mint: row.mint,
    subscription_status: row.status,
    subscribe_tx_sig: row.subscribeTxSig,
    last_tx_sig: row.lastTxSig,
    last_event_id: row.lastEventId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/**
 * Native Solana Subscriptions & Allowances prepare/read routes.
 *
 * These routes expose Solana's native subscriptions program through
 * Leash's prepare/submit pattern. The API never receives private keys:
 * callers provide signer pubkeys, receive unsigned transactions, sign
 * locally, then broadcast through `/v1/submit` or their own RPC.
 */

import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getNativeSubscriptionAuthority,
  prepareCancelNativeSubscription,
  prepareCloseNativeSubscriptionAuthority,
  prepareCollectNativeSubscription,
  prepareCreateNativeFixedAllowance,
  prepareCreateNativeRecurringAllowance,
  prepareCreateNativeSubscriptionPlan,
  prepareInitNativeSubscriptionAuthority,
  prepareResumeNativeSubscription,
  prepareRevokeNativeAllowance,
  prepareRevokeNativeSubscription,
  prepareSubscribeNativeSubscriptionPlan,
  prepareTransferNativeFixedAllowance,
  prepareTransferNativeRecurringAllowance,
  prepareUpdateNativeSubscriptionPlan,
} from '@leashmarket/registry-utils';
import { publicKey } from '@metaplex-foundation/umi';
import type { TransactionBuilder } from '@metaplex-foundation/umi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import { PubkeySchema, TokenProgramFlavorSchema } from '../openapi/common.js';
import type { EventKind } from '../storage/events.js';
import type { DbClient } from '../storage/turso.js';
import { wrapPrepared } from '../util/prepare.js';
import { umiForRequest, umiReadOnly } from '../util/umi.js';

type NativeContext = Context<{ Variables: AuthVariables }>;

const SignerBody = z.object({
  payer: PubkeySchema,
  owner: PubkeySchema.optional(),
  client_reference: z.string().max(256).optional(),
});

const MintBody = z.object({
  spl_mint: PubkeySchema,
  token_program: TokenProgramFlavorSchema.optional(),
});

const ProgramBody = z.object({
  program_address: PubkeySchema.optional(),
});

const AmountString = z.string().regex(/^\d+$/);

const AuthorityBody = SignerBody.merge(MintBody).merge(ProgramBody);

const FixedCreateBody = AuthorityBody.extend({
  delegatee: PubkeySchema,
  amount: AmountString,
  nonce: AmountString.optional(),
  expiry_ts: AmountString.optional(),
});

const RecurringCreateBody = AuthorityBody.extend({
  delegatee: PubkeySchema,
  amount_per_period: AmountString,
  period_length_seconds: AmountString,
  start_ts: AmountString.optional(),
  expiry_ts: AmountString.optional(),
  nonce: AmountString.optional(),
});

const AllowanceTransferBody = SignerBody.merge(MintBody).merge(ProgramBody).extend({
  delegator: PubkeySchema,
  delegatee: PubkeySchema.optional(),
  allowance: PubkeySchema.optional(),
  nonce: AmountString.optional(),
  receiver: PubkeySchema.optional(),
  receiver_token_account: PubkeySchema.optional(),
  amount: AmountString,
});

const AllowanceRevokeBody = SignerBody.merge(ProgramBody).extend({
  allowance: PubkeySchema,
  receiver: PubkeySchema.optional(),
});

const PlanCreateBody = SignerBody.merge(MintBody)
  .merge(ProgramBody)
  .extend({
    plan_id: AmountString,
    amount: AmountString,
    period_hours: AmountString,
    end_ts: AmountString.optional(),
    destinations: z.array(PubkeySchema).max(4).optional(),
    pullers: z.array(PubkeySchema).max(4).optional(),
    metadata_uri: z.string().max(256).optional(),
  });

const PlanUpdateBody = SignerBody.merge(ProgramBody).extend({
  status: z.enum(['active', 'sunset']),
  end_ts: AmountString.optional(),
  pullers: z.array(PubkeySchema).max(4).optional(),
  metadata_uri: z.string().max(256).optional(),
});

const SubscribeBody = SignerBody.merge(MintBody).merge(ProgramBody).extend({
  merchant: PubkeySchema,
  plan_id: AmountString,
});

const SubscriptionLifecycleBody = SignerBody.merge(ProgramBody).extend({
  plan: PubkeySchema,
  subscriber: PubkeySchema.optional(),
  receiver: PubkeySchema.optional(),
});

const CollectBody = SignerBody.merge(MintBody).merge(ProgramBody).extend({
  plan: PubkeySchema,
  delegator: PubkeySchema,
  receiver: PubkeySchema.optional(),
  receiver_token_account: PubkeySchema.optional(),
  amount: AmountString,
});

function tokenProgramFromFlavor(flavor?: 'spl' | 'token-2022') {
  return flavor === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
}

function ownerOrPayer(body: { owner?: string; payer: string }): string {
  return body.owner ?? body.payer;
}

function bi(value: string | undefined, fallback = 0n): bigint {
  return value == null ? fallback : BigInt(value);
}

function programAddress(body: { program_address?: string }): string {
  return body.program_address ?? NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS;
}

async function prepared<TEcho>(args: {
  deps: { config: LeashApiConfig; db: DbClient };
  c: NativeContext;
  kind: EventKind;
  agentMint: string;
  payer: string;
  owner?: string;
  mint?: string | null;
  amountAtomic?: bigint | null;
  metadata: Record<string, unknown>;
  builder: TransactionBuilder;
  echo: TEcho;
}) {
  const network = args.c.var.network;
  const umi = umiForRequest(args.deps.config, {
    network,
    payer: args.payer,
    authority: args.owner ?? args.payer,
  });
  return wrapPrepared({
    db: args.deps.db,
    umi,
    kind: args.kind,
    network,
    apiKeyId: args.c.var.apiKey.id,
    clientReference: args.c.var.clientReference ?? null,
    agentAsset: args.agentMint,
    mint: args.mint ?? null,
    amountAtomic: args.amountAtomic ?? null,
    metadata: args.metadata,
    builder: args.builder,
    echo: args.echo,
  });
}

export function buildNativeSubscriptionRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.get('/v1/agents/:mint/subscriptions/authority', async (c) => {
    const agentMint = c.req.param('mint');
    const query = z
      .object({
        owner: PubkeySchema,
        spl_mint: PubkeySchema,
        token_program: TokenProgramFlavorSchema.optional(),
        program_address: PubkeySchema.optional(),
      })
      .parse(c.req.query());
    const umi = umiReadOnly(deps.config, c.var.network);
    const status = await getNativeSubscriptionAuthority(umi, {
      owner: query.owner,
      mint: query.spl_mint,
      tokenProgram: tokenProgramFromFlavor(query.token_program),
      programAddress: programAddress(query),
    });
    return c.json({
      kind: 'native_subscription_authority',
      status: 'ok',
      agent_mint: agentMint,
      network: c.var.network,
      ...status,
      init_id: status.initId?.toString() ?? null,
      data: status.data
        ? {
            user: String(status.data.user),
            token_mint: String(status.data.tokenMint),
            payer: String(status.data.payer),
            bump: status.data.bump,
            init_id: status.data.initId.toString(),
          }
        : null,
    });
  });

  app.post('/v1/agents/:mint/subscriptions/authority/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = AuthorityBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareInitNativeSubscriptionAuthority(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.subscription_authority.init',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      metadata: {
        rail: 'native_subscription',
        owner: ownerOrPayer(body),
        authority: preparedTx.authority,
        user_token_account: preparedTx.userTokenAccount,
        token_program: preparedTx.tokenProgram,
      },
      builder: preparedTx.builder,
      echo: {
        authority: preparedTx.authority,
        owner: preparedTx.owner,
        spl_mint: preparedTx.mint,
        token_program: preparedTx.tokenProgram,
        user_token_account: preparedTx.userTokenAccount,
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/subscriptions/authority/close/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = AuthorityBody.extend({ receiver: PubkeySchema.optional() }).parse(
      await c.req.json(),
    );
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareCloseNativeSubscriptionAuthority(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      ...(body.receiver ? { receiver: body.receiver } : {}),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.subscription_authority.close',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      metadata: {
        rail: 'native_subscription',
        owner: ownerOrPayer(body),
        authority: preparedTx.authority,
        receiver: body.receiver ?? null,
      },
      builder: preparedTx.builder,
      echo: {
        authority: preparedTx.authority,
        owner: preparedTx.owner,
        spl_mint: preparedTx.mint,
        receiver: body.receiver ?? null,
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/allowances/fixed/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = FixedCreateBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareCreateNativeFixedAllowance(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      delegatee: body.delegatee,
      amount: BigInt(body.amount),
      nonce: bi(body.nonce),
      expiryTs: bi(body.expiry_ts),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.allowance.fixed.create',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      amountAtomic: BigInt(body.amount),
      metadata: {
        rail: 'native_subscription',
        allowance_type: 'fixed',
        owner: preparedTx.owner,
        delegatee: preparedTx.delegatee,
        allowance: preparedTx.allowance,
        authority: preparedTx.authority,
        nonce: bi(body.nonce).toString(),
        expiry_ts: bi(body.expiry_ts).toString(),
      },
      builder: preparedTx.builder,
      echo: {
        authority: preparedTx.authority,
        allowance: preparedTx.allowance,
        owner: preparedTx.owner,
        delegatee: preparedTx.delegatee,
        spl_mint: preparedTx.mint,
        amount: body.amount,
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/allowances/fixed/transfer/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = AllowanceTransferBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareTransferNativeFixedAllowance(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      delegator: body.delegator,
      ...(body.delegatee ? { delegatee: body.delegatee } : {}),
      ...(body.allowance ? { allowance: body.allowance } : {}),
      nonce: bi(body.nonce),
      ...(body.receiver ? { receiver: body.receiver } : {}),
      ...(body.receiver_token_account ? { receiverTokenAccount: body.receiver_token_account } : {}),
      amount: BigInt(body.amount),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.allowance.fixed.transfer',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      amountAtomic: BigInt(body.amount),
      metadata: {
        rail: 'native_subscription',
        allowance_type: 'fixed',
        allowance: preparedTx.allowance,
        delegator: preparedTx.delegator,
        caller: preparedTx.caller,
        receiver_token_account: preparedTx.receiverTokenAccount,
      },
      builder: preparedTx.builder,
      echo: {
        allowance: preparedTx.allowance,
        delegator: preparedTx.delegator,
        caller: preparedTx.caller,
        receiver_token_account: preparedTx.receiverTokenAccount,
        amount: preparedTx.amount.toString(),
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/allowances/fixed/revoke/prepare', async (c) =>
    revokeAllowance(c, deps, 'native.allowance.fixed.revoke'),
  );

  app.post('/v1/agents/:mint/allowances/recurring/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = RecurringCreateBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareCreateNativeRecurringAllowance(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      delegatee: body.delegatee,
      amountPerPeriod: BigInt(body.amount_per_period),
      periodLengthSeconds: BigInt(body.period_length_seconds),
      nonce: bi(body.nonce),
      startTs: body.start_ts ? BigInt(body.start_ts) : undefined,
      expiryTs: bi(body.expiry_ts),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.allowance.recurring.create',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      amountAtomic: BigInt(body.amount_per_period),
      metadata: {
        rail: 'native_subscription',
        allowance_type: 'recurring',
        owner: preparedTx.owner,
        delegatee: preparedTx.delegatee,
        allowance: preparedTx.allowance,
        authority: preparedTx.authority,
        period_length_seconds: body.period_length_seconds,
        nonce: bi(body.nonce).toString(),
      },
      builder: preparedTx.builder,
      echo: {
        authority: preparedTx.authority,
        allowance: preparedTx.allowance,
        owner: preparedTx.owner,
        delegatee: preparedTx.delegatee,
        spl_mint: preparedTx.mint,
        amount_per_period: body.amount_per_period,
        period_length_seconds: body.period_length_seconds,
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/allowances/recurring/transfer/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = AllowanceTransferBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareTransferNativeRecurringAllowance(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      delegator: body.delegator,
      ...(body.delegatee ? { delegatee: body.delegatee } : {}),
      ...(body.allowance ? { allowance: body.allowance } : {}),
      nonce: bi(body.nonce),
      ...(body.receiver ? { receiver: body.receiver } : {}),
      ...(body.receiver_token_account ? { receiverTokenAccount: body.receiver_token_account } : {}),
      amount: BigInt(body.amount),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.allowance.recurring.transfer',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      amountAtomic: BigInt(body.amount),
      metadata: {
        rail: 'native_subscription',
        allowance_type: 'recurring',
        allowance: preparedTx.allowance,
        delegator: preparedTx.delegator,
        caller: preparedTx.caller,
        receiver_token_account: preparedTx.receiverTokenAccount,
      },
      builder: preparedTx.builder,
      echo: {
        allowance: preparedTx.allowance,
        delegator: preparedTx.delegator,
        caller: preparedTx.caller,
        receiver_token_account: preparedTx.receiverTokenAccount,
        amount: preparedTx.amount.toString(),
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/allowances/recurring/revoke/prepare', async (c) =>
    revokeAllowance(c, deps, 'native.allowance.recurring.revoke'),
  );

  app.post('/v1/agents/:mint/subscription-plans/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = PlanCreateBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareCreateNativeSubscriptionPlan(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      planId: BigInt(body.plan_id),
      amount: BigInt(body.amount),
      periodHours: BigInt(body.period_hours),
      endTs: bi(body.end_ts),
      destinations: body.destinations,
      pullers: body.pullers,
      metadataUri: body.metadata_uri,
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.subscription_plan.create',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      amountAtomic: BigInt(body.amount),
      metadata: {
        rail: 'native_subscription',
        plan: preparedTx.plan,
        owner: preparedTx.owner,
        plan_id: body.plan_id,
        period_hours: body.period_hours,
        metadata_uri: body.metadata_uri ?? '',
      },
      builder: preparedTx.builder,
      echo: {
        plan: preparedTx.plan,
        owner: preparedTx.owner,
        plan_id: preparedTx.planId.toString(),
        spl_mint: preparedTx.mint,
        amount: body.amount,
        period_hours: body.period_hours,
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/subscription-plans/:plan/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const plan = c.req.param('plan');
    const body = PlanUpdateBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = prepareUpdateNativeSubscriptionPlan(umi, {
      plan,
      status: body.status,
      endTs: bi(body.end_ts),
      pullers: body.pullers,
      metadataUri: body.metadata_uri,
      programAddress: programAddress(body),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.subscription_plan.update',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      metadata: {
        rail: 'native_subscription',
        plan,
        status: body.status,
      },
      builder: preparedTx.builder,
      echo: { plan, status: body.status },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/subscriptions/subscribe/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const body = SubscribeBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareSubscribeNativeSubscriptionPlan(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      merchant: body.merchant,
      planId: BigInt(body.plan_id),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.subscription.subscribe',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      metadata: {
        rail: 'native_subscription',
        merchant: body.merchant,
        plan: preparedTx.plan,
        subscription: preparedTx.subscription,
        subscriber: preparedTx.subscriber,
      },
      builder: preparedTx.builder,
      echo: {
        plan: preparedTx.plan,
        subscription: preparedTx.subscription,
        subscriber: preparedTx.subscriber,
        spl_mint: preparedTx.mint,
      },
    });
    return c.json(result, 200);
  });

  app.post('/v1/agents/:mint/subscriptions/:subscription/cancel/prepare', async (c) =>
    subscriptionLifecycle(c, deps, 'native.subscription.cancel', prepareCancelNativeSubscription),
  );
  app.post('/v1/agents/:mint/subscriptions/:subscription/resume/prepare', async (c) =>
    subscriptionLifecycle(c, deps, 'native.subscription.resume', prepareResumeNativeSubscription),
  );
  app.post('/v1/agents/:mint/subscriptions/:subscription/revoke/prepare', async (c) =>
    subscriptionLifecycle(c, deps, 'native.subscription.revoke', async (umi, args) =>
      prepareRevokeNativeSubscription(umi, args),
    ),
  );

  app.post('/v1/agents/:mint/subscriptions/:subscription/collect/prepare', async (c) => {
    const agentMint = c.req.param('mint');
    const subscription = c.req.param('subscription');
    const body = CollectBody.parse(await c.req.json());
    const umi = umiForRequest(deps.config, {
      network: c.var.network,
      payer: body.payer,
      authority: ownerOrPayer(body),
    });
    const preparedTx = await prepareCollectNativeSubscription(umi, {
      mint: publicKey(body.spl_mint),
      tokenProgram: tokenProgramFromFlavor(body.token_program),
      programAddress: programAddress(body),
      plan: body.plan,
      subscription,
      delegator: body.delegator,
      ...(body.receiver ? { receiver: body.receiver } : {}),
      ...(body.receiver_token_account ? { receiverTokenAccount: body.receiver_token_account } : {}),
      amount: BigInt(body.amount),
    });
    const result = await prepared({
      deps,
      c,
      kind: 'native.subscription.collect',
      agentMint,
      payer: body.payer,
      owner: ownerOrPayer(body),
      mint: body.spl_mint,
      amountAtomic: BigInt(body.amount),
      metadata: {
        rail: 'native_subscription',
        plan: preparedTx.plan,
        subscription: preparedTx.subscription,
        caller: preparedTx.caller,
        delegator: preparedTx.delegator,
        receiver_token_account: preparedTx.receiverTokenAccount,
      },
      builder: preparedTx.builder,
      echo: {
        plan: preparedTx.plan,
        subscription: preparedTx.subscription,
        caller: preparedTx.caller,
        delegator: preparedTx.delegator,
        receiver_token_account: preparedTx.receiverTokenAccount,
        amount: preparedTx.amount.toString(),
      },
    });
    return c.json(result, 200);
  });

  return app;
}

async function revokeAllowance(
  c: NativeContext,
  deps: { config: LeashApiConfig; db: DbClient },
  kind: EventKind,
) {
  const agentMint = c.req.param('mint') ?? '';
  const body = AllowanceRevokeBody.parse(await c.req.json());
  const umi = umiForRequest(deps.config, {
    network: c.var.network,
    payer: body.payer,
    authority: ownerOrPayer(body),
  });
  const preparedTx = prepareRevokeNativeAllowance(umi, {
    allowance: body.allowance,
    ...(body.receiver ? { receiver: body.receiver } : {}),
    programAddress: programAddress(body),
  });
  const result = await prepared({
    deps,
    c,
    kind,
    agentMint,
    payer: body.payer,
    owner: ownerOrPayer(body),
    metadata: {
      rail: 'native_subscription',
      allowance: body.allowance,
      receiver: body.receiver ?? null,
    },
    builder: preparedTx.builder,
    echo: {
      allowance: body.allowance,
      receiver: body.receiver ?? null,
    },
  });
  return c.json(result, 200);
}

async function subscriptionLifecycle(
  c: NativeContext,
  deps: { config: LeashApiConfig; db: DbClient },
  kind: EventKind,
  prepareFn: (
    umi: ReturnType<typeof umiForRequest>,
    args: {
      plan: string;
      subscription: string;
      subscriber?: string;
      receiver?: string;
      programAddress?: string;
    },
  ) =>
    | Promise<{
        builder: TransactionBuilder;
        plan: string;
        subscription: string;
        subscriber: string;
      }>
    | { builder: TransactionBuilder; plan: string; subscription: string; subscriber: string },
) {
  const agentMint = c.req.param('mint') ?? '';
  const subscription = c.req.param('subscription') ?? '';
  const body = SubscriptionLifecycleBody.parse(await c.req.json());
  const umi = umiForRequest(deps.config, {
    network: c.var.network,
    payer: body.payer,
    authority: ownerOrPayer(body),
  });
  const preparedTx = await prepareFn(umi, {
    plan: body.plan,
    subscription,
    ...(body.subscriber ? { subscriber: body.subscriber } : {}),
    ...(body.receiver ? { receiver: body.receiver } : {}),
    programAddress: programAddress(body),
  });
  const result = await prepared({
    deps,
    c,
    kind,
    agentMint,
    payer: body.payer,
    owner: ownerOrPayer(body),
    metadata: {
      rail: 'native_subscription',
      plan: preparedTx.plan,
      subscription: preparedTx.subscription,
      subscriber: preparedTx.subscriber,
    },
    builder: preparedTx.builder,
    echo: {
      plan: preparedTx.plan,
      subscription: preparedTx.subscription,
      subscriber: preparedTx.subscriber,
    },
  });
  return c.json(result, 200);
}

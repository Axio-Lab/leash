import { describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';
import { ingestChainEvent } from '../src/storage/events.js';
import {
  buildNativePlanMetadata,
  listNativeSubscriptionEvents,
  nativePlanExplorerUrl,
  nativePlanMetadataUri,
  upsertNativeSubscription,
  upsertNativeSubscriptionPlan,
} from '../src/storage/native-subscriptions.js';

const AGENT_MINT = 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp';
const MERCHANT_WALLET = '6vWQv7PYYJ43uM3yHrUrLoXkWE3TUkHRMyYstUjt8gnj';
const SUBSCRIBER_WALLET = '8x7nQv2C8j7e6jK6YwCmcEHEFDxFR6PAYgFdLP6L4tPP';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PLAN = '9Ao5d2oVtPZtCKrq56EZBJYn9QDiGYC6t6B6Gv5Tzsbr';
const SUBSCRIPTION = 'ATq3bB4D7Q8RzK5w2A6HNyKVbL6uS2ZhvfR2eKJr3n1A';

describe('native subscription read model', () => {
  it('serves hosted plan metadata and subscription detail for Explorer', async () => {
    const rig = await createTestRig();
    const network = 'solana-devnet';
    const metadataUri = nativePlanMetadataUri({
      apiOrigin: rig.config.publicOrigin,
      network,
      plan: PLAN,
    });
    const metadata = buildNativePlanMetadata({
      name: 'Oath membership',
      description: 'Weekly membership for the Oath community.',
      amount: '19.99',
      amountAtomic: '19990000',
      currency: 'USDC',
      mint: USDC_DEVNET,
      periodHours: '168',
      merchantAgent: AGENT_MINT,
      merchantWallet: MERCHANT_WALLET,
      plan: PLAN,
      planId: '42',
      network,
      explorerUrl: nativePlanExplorerUrl({
        explorerOrigin: rig.config.explorerPublicOrigin,
        network,
        plan: PLAN,
      }),
    });

    const planEvent = await ingestChainEvent(rig.db, {
      kind: 'native.subscription_plan.create',
      network,
      signature: 'native-plan-create-sig',
      agentAsset: AGENT_MINT,
      mint: USDC_DEVNET,
      amountAtomic: '19990000',
      metadata: { rail: 'native_subscription', plan: PLAN },
      source: 'mcp',
    });
    await upsertNativeSubscriptionPlan(rig.db, {
      network,
      plan: PLAN,
      agentMint: AGENT_MINT,
      merchantWallet: MERCHANT_WALLET,
      planId: '42',
      mint: USDC_DEVNET,
      tokenProgram: 'spl-token',
      symbol: 'USDC',
      amountAtomic: '19990000',
      periodHours: '168',
      status: 'active',
      metadataUri,
      metadata,
      createTxSig: 'native-plan-create-sig',
      lastEventId: planEvent.eventId,
    });

    const detailRes = await rig.app.fetch(
      new Request(`http://test.local/v1/subscription-plans/${PLAN}?network=${network}`),
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      kind: string;
      metadata_uri: string;
      metadata: { name: string; price: { amount: string; amount_atomic: string } };
    };
    expect(detail.kind).toBe('native_subscription_plan');
    expect(detail.metadata_uri).toBe(metadataUri);
    expect(detail.metadata.name).toBe('Oath membership');
    expect(detail.metadata.price).toMatchObject({
      amount: '19.99',
      amount_atomic: '19990000',
    });

    const metadataRes = await rig.app.fetch(
      new Request(`http://test.local/v1/subscription-plans/${PLAN}/metadata?network=${network}`),
    );
    expect(metadataRes.status).toBe(200);
    const hosted = (await metadataRes.json()) as { type: string; name: string };
    expect(hosted).toMatchObject({
      type: 'leash.native_subscription_plan',
      name: 'Oath membership',
    });

    const subscriptionEvent = await ingestChainEvent(rig.db, {
      kind: 'native.subscription.subscribe',
      network,
      signature: 'native-subscribe-sig',
      agentAsset: AGENT_MINT,
      mint: USDC_DEVNET,
      metadata: {
        rail: 'native_subscription',
        plan: PLAN,
        subscription: SUBSCRIPTION,
      },
      source: 'mcp',
    });
    await upsertNativeSubscription(rig.db, {
      network,
      subscription: SUBSCRIPTION,
      plan: PLAN,
      agentMint: AGENT_MINT,
      subscriberWallet: SUBSCRIBER_WALLET,
      mint: USDC_DEVNET,
      subscribeTxSig: 'native-subscribe-sig',
      lastTxSig: 'native-subscribe-sig',
      lastEventId: subscriptionEvent.eventId,
    });

    const subscriptionRes = await rig.app.fetch(
      new Request(`http://test.local/v1/subscriptions/${SUBSCRIPTION}?network=${network}`),
    );
    expect(subscriptionRes.status).toBe(200);
    const subscription = (await subscriptionRes.json()) as {
      kind: string;
      plan: string;
      subscription_status: string;
    };
    expect(subscription).toMatchObject({
      kind: 'native_subscription',
      plan: PLAN,
      subscription_status: 'active',
    });

    const events = await listNativeSubscriptionEvents(rig.db, { network, plan: PLAN });
    expect(events.map((event) => event.kind)).toEqual([
      'native.subscription.subscribe',
      'native.subscription_plan.create',
    ]);
  });
});

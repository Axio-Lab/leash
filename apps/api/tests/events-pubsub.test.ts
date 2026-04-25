/**
 * Live-event pub/sub fanout tests.
 *
 * Verifies the cross-process broadcast contract the Explorer's SSE
 * route depends on:
 *
 *   1. Every `events.ts` write (createPreparedEvent, markSubmitted,
 *      markConfirmed, markFailed, ingestChainEvent) publishes a
 *      `LiveEventMessage` on the network-scoped channel.
 *   2. The publish payload mirrors the underlying row's id, kind,
 *      phase, network, and agent — small enough that the wire stays
 *      lean but rich enough to filter client-side.
 *   3. Subscribers only receive messages for their own network — a
 *      mainnet event must NOT cross-fire on a devnet subscription.
 *
 * Both sides run in the same vitest process so the in-memory bridge
 * inside `MemoryCacheClient` is exercised. Production uses the
 * dedicated ioredis subscriber path inside `createEventSubscriber`,
 * but the contract above is identical.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';
import {
  createEventSubscriber,
  liveEventChannel,
  type EventSubscriber,
  type LiveEventMessage,
} from '../src/storage/events-pubsub.js';
import {
  createPreparedEvent,
  ingestChainEvent,
  markConfirmed,
  markSubmitted,
} from '../src/storage/events.js';

const TICK = () => new Promise<void>((r) => setImmediate(r));

describe('live-event pub/sub', () => {
  let subscribers: EventSubscriber[] = [];
  afterEach(async () => {
    await Promise.all(subscribers.map((s) => s.close()));
    subscribers = [];
  });

  async function newSubscriber(): Promise<EventSubscriber> {
    // No URL → in-memory bridge, which `MemoryCacheClient.publish`
    // delivers to synchronously. Production paths use ioredis.
    const sub = await createEventSubscriber(null);
    subscribers.push(sub);
    return sub;
  }

  it('exposes a stable channel name per network', () => {
    expect(liveEventChannel('solana-devnet')).toBe('leash:events:solana-devnet');
    expect(liveEventChannel('solana-mainnet')).toBe('leash:events:solana-mainnet');
  });

  it('publishes a message for every lifecycle write', async () => {
    const rig = await createTestRig();
    const sub = await newSubscriber();
    const received: LiveEventMessage[] = [];
    await sub.subscribe('solana-devnet', (m) => received.push(m));

    // Walk the full prepared → submitted → confirmed transition. Each
    // hop calls `fanoutEvent`, which publishes one message.
    const id = await createPreparedEvent(rig.db, {
      kind: 'submit.raw',
      network: 'solana-devnet',
    });
    await markSubmitted(rig.db, id, 'sig-pubsub-1');
    await markConfirmed(rig.db, id);

    // The bridge is synchronous but `fanoutEvent` awaits a few async
    // hops (DB read + dynamic imports). Yield once so all microtasks
    // queued by those imports flush.
    await TICK();

    expect(received).toHaveLength(3);
    expect(received[0]).toMatchObject({
      id,
      kind: 'submit.raw',
      phase: 'prepared',
      network: 'solana-devnet',
    });
    expect(received[1]).toMatchObject({ id, phase: 'submitted' });
    expect(received[2]).toMatchObject({ id, phase: 'confirmed' });
  });

  it('publishes for chain-ingested events too', async () => {
    const rig = await createTestRig();
    const sub = await newSubscriber();
    const received: LiveEventMessage[] = [];
    await sub.subscribe('solana-devnet', (m) => received.push(m));

    const result = await ingestChainEvent(rig.db, {
      kind: 'agent.treasury.withdraw',
      network: 'solana-devnet',
      signature: 'chain-sig-xyz',
      agentAsset: 'AgentAsset111',
      mint: 'MintXYZ',
      amountAtomic: '1000',
    });
    await TICK();

    expect(result.duplicate).toBe(false);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: result.eventId,
      kind: 'agent.treasury.withdraw',
      phase: 'confirmed',
      network: 'solana-devnet',
      agent: 'AgentAsset111',
    });
  });

  it('isolates subscribers by network — devnet never sees mainnet writes', async () => {
    // Two rigs so we can write devnet AND mainnet events independently;
    // a single rig only carries one API-key network but the storage
    // helpers accept both, so we reuse one rig and pass network in.
    const rig = await createTestRig();
    const devSub = await newSubscriber();
    const mainSub = await newSubscriber();
    const dev: LiveEventMessage[] = [];
    const main: LiveEventMessage[] = [];
    await devSub.subscribe('solana-devnet', (m) => dev.push(m));
    await mainSub.subscribe('solana-mainnet', (m) => main.push(m));

    await createPreparedEvent(rig.db, {
      kind: 'submit.raw',
      network: 'solana-devnet',
    });
    await createPreparedEvent(rig.db, {
      kind: 'submit.raw',
      network: 'solana-mainnet',
    });
    await TICK();

    expect(dev).toHaveLength(1);
    expect(dev[0].network).toBe('solana-devnet');
    expect(main).toHaveLength(1);
    expect(main[0].network).toBe('solana-mainnet');
  });

  it('does NOT publish when the publisher cache is unset', async () => {
    // `setEventPublisherCache(null)` simulates the dev/test default
    // before boot wires the cache up. We expect `fanoutEvent` to
    // continue working (webhooks still fire) while pub/sub is silent.
    const rig = await createTestRig();
    const sub = await newSubscriber();
    const received: LiveEventMessage[] = [];
    await sub.subscribe('solana-devnet', (m) => received.push(m));

    const { setEventPublisherCache } = await import('../src/storage/events-pubsub.js');
    setEventPublisherCache(null);
    try {
      await createPreparedEvent(rig.db, {
        kind: 'submit.raw',
        network: 'solana-devnet',
      });
      await TICK();
      expect(received).toHaveLength(0);
    } finally {
      // Re-arm so subsequent tests in the same file see the publisher.
      // (Vitest reuses the worker process across `it` blocks.)
      const { getCache } = await import('../src/storage/redis.js');
      setEventPublisherCache(getCache(rig.config));
    }
  });
});

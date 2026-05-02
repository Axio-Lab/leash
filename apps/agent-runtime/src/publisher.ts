import { Redis } from 'ioredis';

import type { ActivityEnvelope } from './types.js';

export type Publisher = {
  publish(env: ActivityEnvelope): Promise<void>;
  close(): Promise<void>;
};

/**
 * Activity stream channel name used by both the runtime publisher and
 * the SSE consumer in `apps/agents`. Keep these aligned.
 */
export function activityChannel(taskId: string): string {
  return `leash:activity:${taskId}`;
}

class RedisPublisher implements Publisher {
  constructor(private readonly r: Redis) {}
  async publish(env: ActivityEnvelope): Promise<void> {
    await this.r.publish(activityChannel(env.taskId), JSON.stringify(env));
  }
  async close(): Promise<void> {
    await this.r.quit().catch(() => undefined);
  }
}

class NoopPublisher implements Publisher {
  async publish(): Promise<void> {
    /* no-op */
  }
  async close(): Promise<void> {
    /* no-op */
  }
}

export function createPublisher(redisUrl: string | undefined): Publisher {
  if (!redisUrl) return new NoopPublisher();
  const r = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  return new RedisPublisher(r);
}

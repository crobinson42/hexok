import type { Logger } from '@hexok/logger';
import { MemoryQuarantine } from '@hexok/quarantine';
import type { RedisQueue } from '@hexok/queue-redis';
import type { RedisScheduleCoordinator } from '@hexok/schedule-coordinator-redis';
import { connectRedis } from '../../infra/clients/redis-client.js';
import { RedisPosts } from '../../infra/repos/redis-posts.js';
import { RedisSubscribers } from '../../infra/repos/redis-subscribers.js';
import { createDomainEventsQueue } from './domain-events.js';
import { createLogger } from './logger.js';
import { createScheduleCoordinator } from './schedule.js';

/** Infrastructure every process shares. Mail and SMS are created by `createChannelDeliveryServices`. */
export type Runtime = {
  /** The Redis every queue and repository uses. */
  redisUrl: string;
  logger: Logger;
  quarantine: MemoryQuarantine;
  posts: RedisPosts;
  subscribers: RedisSubscribers;
  domainEventsQueue: RedisQueue;
  scheduleCoordinator: RedisScheduleCoordinator;
  /** Stop the queue and coordinator, then close Redis. */
  stop(): Promise<void>;
};

export async function createRuntime(): Promise<Runtime> {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const logger = await createLogger();
  const quarantine = new MemoryQuarantine();
  const redis = await connectRedis(url);
  const domainEventsQueue = createDomainEventsQueue({
    redis: url,
    logger,
    quarantine,
  });
  const scheduleCoordinator = createScheduleCoordinator({
    redis: url,
    logger,
  });
  return {
    redisUrl: url,
    logger,
    quarantine,
    posts: new RedisPosts({ redis }),
    subscribers: new RedisSubscribers({ redis }),
    domainEventsQueue,
    scheduleCoordinator,
    async stop() {
      await scheduleCoordinator.stop();
      await domainEventsQueue.stop();
      await redis.close();
    },
  };
}

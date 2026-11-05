import type { Logger } from '@hexok/logger';
import type { MemoryQuarantine } from '@hexok/quarantine';
import { RedisQueue } from '@hexok/queue-redis';
import { QueueDomainEventPublisher } from '../../infra/events/queues/domain-events.js';

export function createDomainEventsQueue(deps: {
  redis: string;
  logger: Logger;
  quarantine: MemoryQuarantine;
}): RedisQueue {
  return new RedisQueue({
    redis: deps.redis,
    keyPrefix: 'domain:',
    logger: deps.logger,
    quarantine: deps.quarantine,
  });
}

/** The port use cases publish domain events through. */
export function createPublishers(runtime: { domainEventsQueue: RedisQueue }): {
  domainEvents: QueueDomainEventPublisher;
} {
  return {
    domainEvents: new QueueDomainEventPublisher({
      queue: runtime.domainEventsQueue,
    }),
  };
}

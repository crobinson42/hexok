import type { Logger } from '@hexok/logger';
import { RedisScheduleCoordinator } from '@hexok/schedule-coordinator-redis';

export function createScheduleCoordinator(deps: {
  redis: string;
  logger: Logger;
}): RedisScheduleCoordinator {
  return new RedisScheduleCoordinator({
    redis: deps.redis,
    keyPrefix: 'domain:schedule:',
    logger: deps.logger,
  });
}

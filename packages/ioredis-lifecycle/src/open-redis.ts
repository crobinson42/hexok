import { Redis, type RedisOptions } from 'ioredis';

/**
 * Opens an ioredis client with `maxRetriesPerRequest: null`, so a command waits through an outage instead of failing after 20 retries.
 * Options passed in win, including `maxRetriesPerRequest`.
 */
export function openRedis(redis: string | RedisOptions): Redis {
  if (typeof redis === 'string') {
    return new Redis(redis, { maxRetriesPerRequest: null });
  }
  return new Redis({ maxRetriesPerRequest: null, ...redis });
}

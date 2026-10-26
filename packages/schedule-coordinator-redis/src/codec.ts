import { Redis, type RedisOptions } from 'ioredis';

export function openRedis(redis: string | RedisOptions): Redis {
  if (typeof redis === 'string') {
    return new Redis(redis, { maxRetriesPerRequest: null });
  }
  return new Redis({ maxRetriesPerRequest: null, ...redis });
}

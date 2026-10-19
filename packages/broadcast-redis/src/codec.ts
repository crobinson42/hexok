import { Redis, type RedisOptions } from 'ioredis';

export function encodeJson(payload: unknown): string {
  return JSON.stringify(payload);
}

export function decodeJson(raw: string): unknown {
  return JSON.parse(raw);
}

export function openRedis(redis: string | RedisOptions): Redis {
  if (typeof redis === 'string') {
    return new Redis(redis, { maxRetriesPerRequest: null });
  }
  return new Redis({ maxRetriesPerRequest: null, ...redis });
}

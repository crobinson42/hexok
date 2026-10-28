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

export function waitForReady(redis: Redis): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  if (redis.status === 'end') {
    return Promise.reject(new Error('broadcast: redis ended before ready'));
  }
  return new Promise((resolve, reject) => {
    const onReady = () => {
      redis.off('end', onEnd);
      resolve();
    };
    const onEnd = () => {
      redis.off('ready', onReady);
      reject(new Error('broadcast: redis ended before ready'));
    };
    redis.once('ready', onReady);
    redis.once('end', onEnd);
    // The events settle the promise. A connect failure also emits 'error'.
    if (redis.status === 'wait') redis.connect().catch(() => {});
  });
}

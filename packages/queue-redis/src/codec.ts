import { Redis, type RedisOptions } from 'ioredis';

export function encodeJson(payload: unknown): string {
  return JSON.stringify(payload);
}

export function decodeJson(raw: string): unknown {
  return JSON.parse(raw);
}

/**
 * ioredis waits `disconnectTimeout` for a closed socket that never emits `close` again, which holds the process after `stop()`.
 * A live socket closes well within 100ms.
 */
const defaults = { maxRetriesPerRequest: null, disconnectTimeout: 100 };

export function openRedis(redis: string | RedisOptions): Redis {
  if (typeof redis === 'string') return new Redis(redis, { ...defaults });
  return new Redis({ ...defaults, ...redis });
}

/** Resolves on `ready`. Rejects on `end` or `signal`. Connects a `lazyConnect` client. ioredis retries through `error`. */
export function untilReady(client: Redis, signal: AbortSignal): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const settle = (error?: unknown) => {
      client.off('ready', onReady);
      client.off('end', onEnd);
      signal.removeEventListener('abort', onAbort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReady = () => settle();
    const onEnd = () =>
      settle(new Error('queue: redis connection ended before ready'));
    const onAbort = () => settle(signal.reason);
    client.once('ready', onReady);
    client.once('end', onEnd);
    signal.addEventListener('abort', onAbort);
    if (client.status === 'wait') client.connect().catch(() => undefined);
  });
}

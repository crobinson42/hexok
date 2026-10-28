import { randomUUID } from 'node:crypto';
import { describeRedisLifecycle } from '@hexok/test-redis';
import type { RedisOptions } from 'ioredis';
import { openRedis } from './open-redis.js';
import { RedisLifecycle } from './redis-lifecycle.js';

interface FakeConfig {
  readonly redis: RedisOptions;
  readonly stopTimeoutMs: number;
}

/** The smallest adapter on the lifecycle: one client and one guarded command. */
class PingAdapter {
  readonly #redis: RedisOptions;
  readonly #lifecycle: RedisLifecycle<{
    commands: ReturnType<typeof openRedis>;
  }>;

  constructor(config: FakeConfig) {
    this.#redis = config.redis;
    this.#lifecycle = new RedisLifecycle({
      adapter: 'ping',
      stopTimeoutMs: config.stopTimeoutMs,
    });
  }

  start(): Promise<void> {
    return this.#lifecycle.start(() => ({ commands: openRedis(this.#redis) }));
  }

  ping(): Promise<string> {
    return this.#lifecycle.run('ping', ({ commands }) => commands.ping());
  }

  /** A guarded command that Redis answers after 150 ms. */
  slowRead(): Promise<unknown> {
    return this.#lifecycle.run('slowRead', ({ commands }) =>
      commands.blpop(`hexok:lifecycle:it:${randomUUID()}`, 0.15),
    );
  }

  stop(): Promise<void> {
    return this.#lifecycle.stop();
  }
}

/** Two clients, a timer set on ready, and a cleanup that writes to Redis, like a lock adapter. */
class LockAdapter {
  readonly #redis: RedisOptions;
  readonly #key = `hexok:lifecycle:it:${randomUUID()}`;
  readonly #lifecycle: RedisLifecycle<{
    commands: ReturnType<typeof openRedis>;
    watcher: ReturnType<typeof openRedis>;
  }>;
  #renew: ReturnType<typeof setInterval> | undefined;

  constructor(config: FakeConfig) {
    this.#redis = config.redis;
    this.#lifecycle = new RedisLifecycle({
      adapter: 'lock',
      stopTimeoutMs: config.stopTimeoutMs,
    });
  }

  start(): Promise<void> {
    return this.#lifecycle.start(
      () => ({
        commands: openRedis(this.#redis),
        watcher: openRedis({ ...this.#redis, lazyConnect: true }),
      }),
      () => {
        this.#renew = setInterval(() => {}, 1000);
      },
    );
  }

  acquire(): Promise<string | null> {
    return this.#lifecycle.run('acquire', ({ commands }) =>
      commands.set(this.#key, 'owner', 'PX', 10_000),
    );
  }

  stop(): Promise<void> {
    return this.#lifecycle.stop(async ({ run }) => {
      clearInterval(this.#renew);
      this.#renew = undefined;
      await run('release', ({ commands }) => commands.del(this.#key));
    });
  }
}

describeRedisLifecycle('PingAdapter', (config) => {
  const adapter = new PingAdapter(config);
  return {
    start: () => adapter.start(),
    stop: () => adapter.stop(),
    operate: () => adapter.ping(),
    inFlight: () => adapter.slowRead(),
  };
});

// No inFlight, so that test skips.
describeRedisLifecycle('LockAdapter', (config) => {
  const adapter = new LockAdapter(config);
  return {
    start: () => adapter.start(),
    stop: () => adapter.stop(),
    operate: () => adapter.acquire(),
  };
});

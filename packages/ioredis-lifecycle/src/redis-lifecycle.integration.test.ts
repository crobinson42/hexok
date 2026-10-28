import { randomUUID } from 'node:crypto';
import { RedisProxy, runNode } from '@hexok/test-redis';
import { Redis, type RedisOptions } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LifecycleError } from './errors.js';
import { openRedis } from './open-redis.js';
import { RedisLifecycle } from './redis-lifecycle.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

const entry = new URL('./index.ts', import.meta.url).href;

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

async function timed(promise: Promise<unknown>): Promise<number> {
  const started = Date.now();
  await promise;
  return Date.now() - started;
}

describe.skipIf(!process.env.REDIS_URL)('RedisLifecycle integration', () => {
  let proxy: RedisProxy;
  let redis: RedisOptions;
  const lifecycles: RedisLifecycle[] = [];

  function lifecycle(
    options: { stopTimeoutMs?: number; startTimeoutMs?: number } = {},
  ): RedisLifecycle<{ main: Redis }> {
    const made = new RedisLifecycle<{ main: Redis }>({
      adapter: 'it',
      stopTimeoutMs: options.stopTimeoutMs ?? 500,
      startTimeoutMs: options.startTimeoutMs,
    });
    lifecycles.push(made as unknown as RedisLifecycle);
    return made;
  }

  beforeEach(async () => {
    proxy = await RedisProxy.start();
    redis = { host: proxy.host, port: proxy.port, disconnectTimeout: 200 };
  });

  afterEach(async () => {
    await Promise.all(lifecycles.splice(0).map((made) => made.stop()));
    await proxy.close();
  });

  it('start rejects with EndedBeforeReady when retryStrategy gives up', async () => {
    await proxy.refuse();
    const made = lifecycle();
    const error = await caught(
      made.start(() => ({
        main: openRedis({ ...redis, retryStrategy: () => null }),
      })),
    );
    expect(LifecycleError.is(error)).toBe(true);
    expect(error).toMatchObject({ code: 'EndedBeforeReady' });
    expect(made.state).toBe('idle');
  });

  it('a client that ends after ready is logged at error, state stays ready, and commands fail', async () => {
    const logged: unknown[][] = [];
    const made = new RedisLifecycle<{ main: Redis }>({
      adapter: 'it',
      stopTimeoutMs: 300,
      logger: {
        debug() {},
        info() {},
        warn() {},
        error: (message, fields) => {
          logged.push([message, fields]);
        },
      },
    });
    lifecycles.push(made as unknown as RedisLifecycle);
    const client = openRedis({
      ...redis,
      retryStrategy: (times) => (times > 2 ? null : 10),
    });
    await made.start(() => ({ main: client }));
    await proxy.refuse();
    proxy.drop();
    await until(() => client.status === 'end');
    expect(made.state).toBe('ready');
    expect(logged).toContainEqual([
      'it: the main connection ended after start(). Commands fail until you call stop() and start() again.',
      { adapter: 'it', connection: 'main' },
    ]);
    await expect(made.run('ping', ({ main }) => main.ping())).rejects.toThrow(
      'Connection is closed.',
    );
  });

  it('start rejects with StartTimeout while Redis is blackholed', async () => {
    proxy.blackhole();
    const made = lifecycle({ startTimeoutMs: 300 });
    let client: Redis | undefined;
    const ms = await timed(
      caught(
        made.start(() => {
          client = openRedis(redis);
          return { main: client };
        }),
      ).then((error) => {
        expect(error).toMatchObject({ code: 'StartTimeout' });
      }),
    );
    expect(ms).toBeGreaterThanOrEqual(290);
    expect(ms).toBeLessThan(800);
    await until(() => client?.status === 'end');
  });

  it('stop resolves within stopTimeoutMs while a ready client is blackholed', async () => {
    const made = lifecycle({ stopTimeoutMs: 400 });
    const client = openRedis(redis);
    await made.start(() => ({ main: client }));
    proxy.blackhole();
    expect(await timed(made.stop())).toBeLessThan(400 + 200);
    expect(made.state).toBe('stopped');
  });

  it('stop resolves while the client is reconnecting', async () => {
    const made = lifecycle({ stopTimeoutMs: 400 });
    const client = openRedis(redis);
    await made.start(() => ({ main: client }));
    await proxy.refuse();
    proxy.drop();
    await until(() => client.status === 'reconnecting');
    expect(await timed(made.stop())).toBeLessThan(100);
    // ioredis never emits `end` here, which is why a readiness wait must be cancellable.
    expect(client.status).toBe('reconnecting');
  });

  it('guarded commands queued during an outage reject with StoppedBeforeReply on stop', async () => {
    const made = lifecycle({ stopTimeoutMs: 300 });
    const client = openRedis(redis);
    await made.start(() => ({ main: client }));
    await proxy.refuse();
    proxy.drop();
    await until(() => client.status === 'reconnecting');
    const queued = [1, 2, 3].map((n) =>
      caught(made.run('set', ({ main }) => main.set(`it:${n}`, 'x'))),
    );
    expect(await timed(made.stop())).toBeLessThan(300 + 200);
    for (const error of await Promise.all(queued)) {
      expect(error).toMatchObject({ code: 'StoppedBeforeReply' });
    }
  });

  it('cleanup runs guarded commands against Redis before the clients close', async () => {
    const key = `hexok:lifecycle:it:${randomUUID()}`;
    const probe = new Redis(process.env.REDIS_URL ?? '');
    try {
      const made = lifecycle();
      await made.start(() => ({ main: openRedis(redis) }));
      await made.run('lock', ({ main }) => main.set(key, 'owner'));
      await made.stop(async ({ run }) => {
        await run('release', ({ main }) => main.del(key));
      });
      expect(await probe.exists(key)).toBe(0);
    } finally {
      await probe.quit();
    }
  });

  it('stop closes an attached client and rejects its blocking read', async () => {
    const made = lifecycle({ stopTimeoutMs: 300 });
    await made.start(() => ({ main: openRedis(redis) }));
    const blocking = made.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => openRedis(redis),
    });
    const reading = caught(
      made.run('read', () =>
        blocking.blpop(`hexok:lifecycle:it:${randomUUID()}`, 0),
      ),
    );
    expect(await timed(made.stop())).toBeLessThan(300 + 200);
    expect(await reading).toMatchObject({ code: 'StoppedBeforeReply' });
    await until(() => blocking.status === 'end');
  });

  it('a signal ends a blocking read on a detached client', async () => {
    const made = lifecycle();
    await made.start(() => ({ main: openRedis(redis) }));
    const blocking = made.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => openRedis(redis),
    });
    await until(() => blocking.status === 'ready');
    await proxy.refuse();
    proxy.drop();
    await until(() => blocking.status === 'reconnecting');
    const abort = new AbortController();
    const reading = caught(
      made.run(
        'read',
        () => blocking.blpop(`hexok:lifecycle:it:${randomUUID()}`, 0),
        { signal: abort.signal },
      ),
    );
    const reason = new Error('unsubscribed');
    abort.abort(reason);
    made.detach(blocking);
    expect(await reading).toBe(reason);
  });

  it('the process exits soon after stop while Redis is blackholed', async () => {
    const running = runNode(
      `
import { openRedis, RedisLifecycle } from ${JSON.stringify(entry)};
import { settleWithin } from '@hexok/test-redis';
const lifecycle = new RedisLifecycle({ adapter: 'child', stopTimeoutMs: 300 });
await lifecycle.start(() => ({
  main: openRedis({ host: '127.0.0.1', port: Number(process.env.PORT), disconnectTimeout: 200 }),
}));
// Pings until one goes unanswered, which is when the parent blackholes the proxy.
while (await settleWithin(lifecycle.run('ping', ({ main }) => main.ping()), 100)) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const started = Date.now();
await lifecycle.stop();
console.log(JSON.stringify({ stopMs: Date.now() - started, stoppedAt: Date.now() }));
`,
      { env: { PORT: String(proxy.port) } },
    );
    await until(() => proxy.connections > 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    proxy.blackhole();
    const result = await running;
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const { stopMs, stoppedAt } = JSON.parse(result.stdout) as {
      stopMs: number;
      stoppedAt: number;
    };
    expect(stopMs).toBeLessThan(300 + 200);
    // ioredis destroys the half-closed socket after disconnectTimeout. Nothing else holds the process.
    expect(result.exitedAt - stoppedAt).toBeLessThan(200 + 500);
  });

  it('connection errors go to the logger, and ioredis prints no unhandled error event', async () => {
    await proxy.refuse();
    const result = await runNode(
      `
import { openRedis, RedisLifecycle } from ${JSON.stringify(entry)};
const logged = [];
const lifecycle = new RedisLifecycle({
  adapter: 'child',
  stopTimeoutMs: 300,
  startTimeoutMs: 400,
  logger: { debug() {}, info() {}, warn() {}, error: (error, fields) => logged.push(fields) },
});
const error = await lifecycle
  .start(() => ({
    main: openRedis({ host: '127.0.0.1', port: Number(process.env.PORT), disconnectTimeout: 200 }),
  }))
  .catch((error) => error);
await lifecycle.stop();
console.log(JSON.stringify({ code: error.code, logged, stoppedAt: Date.now() }));
`,
      { env: { PORT: String(proxy.port) } },
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const { code, logged, stoppedAt } = JSON.parse(result.stdout) as {
      code: string;
      logged: unknown[];
      stoppedAt: number;
    };
    expect(code).toBe('StartTimeout');
    expect(logged.length).toBeGreaterThan(0);
    expect(logged[0]).toEqual({ adapter: 'child', connection: 'main' });
    // A reconnecting client's disconnect waits disconnectTimeout on its closed socket. Nothing else holds the process.
    expect(result.exitedAt - stoppedAt).toBeLessThan(200 + 500);
  });
});

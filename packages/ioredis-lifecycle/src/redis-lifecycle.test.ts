import { EventEmitter, getEventListeners } from 'node:events';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LifecycleError } from './errors.js';
import type { LogSink } from './log-sink.js';
import {
  RedisLifecycle,
  type RedisLifecycleOptions,
} from './redis-lifecycle.js';

type Status = 'wait' | 'connecting' | 'ready' | 'reconnecting' | 'end';

/** Mimics the parts of ioredis the lifecycle uses, including `disconnect()` on a reconnecting client never ending it. */
class FakeRedis extends EventEmitter {
  status: Status;
  connects = 0;
  quits = 0;
  disconnects = 0;
  /** `ok` ends the client, `hang` never settles, like a blackholed Redis. */
  quitMode: 'ok' | 'hang' | 'fail' = 'ok';

  constructor(status: Status = 'connecting') {
    super();
    this.status = status;
  }

  get redis(): Redis {
    return this as unknown as Redis;
  }

  connect(): Promise<void> {
    this.connects += 1;
    this.status = 'connecting';
    return Promise.resolve();
  }

  ready(): void {
    this.status = 'ready';
    this.emit('ready');
  }

  end(): void {
    this.status = 'end';
    this.emit('end');
  }

  quit(): Promise<string> {
    this.quits += 1;
    if (this.quitMode === 'hang') return new Promise(() => {});
    if (this.quitMode === 'fail') return Promise.reject(new Error('quit'));
    this.end();
    return Promise.resolve('OK');
  }

  disconnect(): void {
    this.disconnects += 1;
    if (this.status === 'reconnecting') return;
    this.end();
  }

  /** A command that settles only when the test says so. */
  command<T = string>(): Deferred<T> {
    return deferred<T>();
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sink() {
  return {
    debug: vi.fn<LogSink['debug']>(),
    info: vi.fn<LogSink['info']>(),
    warn: vi.fn<LogSink['warn']>(),
    error: vi.fn<LogSink['error']>(),
  };
}

function setup(
  options: Partial<RedisLifecycleOptions> = {},
  status: Status = 'connecting',
) {
  const logger = sink();
  const lifecycle = new RedisLifecycle<{ main: Redis }>({
    adapter: 'test',
    stopTimeoutMs: 1000,
    logger,
    ...options,
  });
  const fake = new FakeRedis(status);
  const open = vi.fn(() => ({ main: fake.redis }));
  return { lifecycle, logger, fake, open };
}

async function started(
  options: Partial<RedisLifecycleOptions> = {},
): Promise<ReturnType<typeof setup>> {
  const made = setup(options, 'ready');
  await made.lifecycle.start(made.open);
  return made;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

function expectCode(error: unknown, code: string): void {
  expect(LifecycleError.is(error)).toBe(true);
  expect(error).toMatchObject({ code });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('state', () => {
  it('a new lifecycle is idle', () => {
    expect(setup().lifecycle.state).toBe('idle');
  });

  it('start moves idle to starting to ready', async () => {
    const { lifecycle, fake, open } = setup();
    const starting = lifecycle.start(open);
    expect(lifecycle.state).toBe('starting');
    fake.ready();
    await starting;
    expect(lifecycle.state).toBe('ready');
  });

  it('stop moves ready to stopping to stopped', async () => {
    const { lifecycle } = await started();
    const stopping = lifecycle.stop();
    expect(lifecycle.state).toBe('stopping');
    await stopping;
    expect(lifecycle.state).toBe('stopped');
  });

  it('stop before start resolves and moves idle to stopped', async () => {
    const { lifecycle, open } = setup();
    await lifecycle.stop();
    expect(lifecycle.state).toBe('stopped');
    expect(open).not.toHaveBeenCalled();
  });

  it('a failed start returns to idle', async () => {
    const { lifecycle, fake, open } = setup();
    const starting = caught(lifecycle.start(open));
    fake.end();
    expectCode(await starting, 'EndedBeforeReady');
    expect(lifecycle.state).toBe('idle');
  });

  it('rejects a negative or non-finite budget with the adapter name', () => {
    expect(
      () => new RedisLifecycle({ adapter: 'queue', stopTimeoutMs: -1 }),
    ).toThrow(
      new RangeError('queue: stopTimeoutMs must be a finite number of ms >= 0'),
    );
    expect(
      () =>
        new RedisLifecycle({
          adapter: 'queue',
          stopTimeoutMs: 1,
          startTimeoutMs: Number.NaN,
        }),
    ).toThrow(
      new RangeError(
        'queue: startTimeoutMs must be a finite number of ms >= 0',
      ),
    );
  });
});

describe('ended after ready', () => {
  const ended =
    'test: the main connection ended after start(). Commands fail until you call stop() and start() again.';

  it('a client that ends while ready is logged at error with adapter and connection', async () => {
    const { logger, fake } = await started();
    fake.end();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(ended, {
      adapter: 'test',
      connection: 'main',
    });
  });

  it('state stays ready after a client ends, and commands still run', async () => {
    const { lifecycle, fake } = await started();
    fake.end();
    expect(lifecycle.state).toBe('ready');
    await expect(lifecycle.run('get', async () => 'OK')).resolves.toBe('OK');
  });

  it('an attached client that ends while ready is logged with its fields', async () => {
    const { lifecycle, logger } = await started();
    const blocking = new FakeRedis('ready');
    lifecycle.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => blocking.redis,
      fields: { topic: 'jobs' },
    });
    blocking.end();
    expect(logger.error).toHaveBeenCalledWith(
      'test: the blocking connection ended after start(). Commands fail until you call stop() and start() again.',
      { topic: 'jobs', adapter: 'test', connection: 'blocking' },
    );
  });

  it('stop does not log the end of the clients it closes', async () => {
    const { lifecycle, logger, fake } = await started();
    const quitting = new FakeRedis('ready');
    lifecycle.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => quitting.redis,
    });
    fake.status = 'reconnecting';
    await lifecycle.stop();
    fake.end();
    expect(quitting.status).toBe('end');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('detach does not log the end of the detached client', async () => {
    const { lifecycle, logger } = await started();
    const blocking = new FakeRedis('ready');
    const client = lifecycle.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => blocking.redis,
    });
    lifecycle.detach(client);
    expect(blocking.status).toBe('end');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a failed start does not log the end of the clients it disconnects', async () => {
    const logger = sink();
    const lifecycle = new RedisLifecycle<{ a: Redis; b: Redis }>({
      adapter: 'test',
      stopTimeoutMs: 1000,
      logger,
    });
    const a = new FakeRedis('ready');
    const b = new FakeRedis();
    const starting = caught(
      lifecycle.start(() => ({ a: a.redis, b: b.redis })),
    );
    b.end();
    expectCode(await starting, 'EndedBeforeReady');
    expect(a.status).toBe('end');
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('start', () => {
  it('start waits for every client to be ready', async () => {
    const lifecycle = new RedisLifecycle<{ a: Redis; b: Redis }>({
      adapter: 'test',
      stopTimeoutMs: 1000,
    });
    const a = new FakeRedis();
    const b = new FakeRedis();
    let done = false;
    const starting = lifecycle
      .start(() => ({ a: a.redis, b: b.redis }))
      .then(() => {
        done = true;
      });
    a.ready();
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    b.ready();
    await starting;
    expect(done).toBe(true);
  });

  it('start connects a lazyConnect client', async () => {
    const { lifecycle, fake, open } = setup({}, 'wait');
    const starting = lifecycle.start(open);
    expect(fake.connects).toBe(1);
    fake.ready();
    await starting;
  });

  it('concurrent start calls share one attempt and call open once', async () => {
    const { lifecycle, fake, open } = setup();
    const first = lifecycle.start(open);
    const second = lifecycle.start(open);
    expect(second).toBe(first);
    fake.ready();
    await Promise.all([first, second]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('start while ready resolves without opening', async () => {
    const { lifecycle, open } = await started();
    await lifecycle.start(open);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('onReady runs once, when ready and before start resolves', async () => {
    const { lifecycle, fake, open } = setup();
    const states: string[] = [];
    const onReady = vi.fn(() => {
      states.push(lifecycle.state);
    });
    const first = lifecycle.start(open, onReady);
    const second = lifecycle.start(open, onReady);
    fake.ready();
    await Promise.all([first, second]);
    await lifecycle.start(open, onReady);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith({ main: fake.redis });
    expect(states).toEqual(['ready']);
  });

  it('a throwing onReady fails start and disconnects the clients', async () => {
    const { lifecycle, fake, open } = setup({}, 'ready');
    const error = await caught(
      lifecycle.start(open, () => {
        throw new Error('setup failed');
      }),
    );
    expect(error).toEqual(new Error('setup failed'));
    expect(lifecycle.state).toBe('idle');
    expect(fake.disconnects).toBe(1);
  });

  it('a throwing open leaves the lifecycle idle', async () => {
    const { lifecycle } = setup();
    const error = await caught(
      lifecycle.start(() => {
        throw new Error('bad options');
      }),
    );
    expect(error).toEqual(new Error('bad options'));
    expect(lifecycle.state).toBe('idle');
  });

  it('start rejects with EndedBeforeReady when a client ends, and disconnects every client', async () => {
    const lifecycle = new RedisLifecycle<{ a: Redis; b: Redis }>({
      adapter: 'queue',
      stopTimeoutMs: 1000,
    });
    const a = new FakeRedis();
    const b = new FakeRedis();
    const starting = caught(
      lifecycle.start(() => ({ a: a.redis, b: b.redis })),
    );
    b.end();
    const error = await starting;
    expectCode(error, 'EndedBeforeReady');
    expect((error as Error).message).toBe(
      'queue: the b connection ended before it was ready. Check the redis options and retryStrategy, then call start() again.',
    );
    expect(a.disconnects).toBe(1);
    expect(a.listenerCount('ready')).toBe(0);
    expect(a.listenerCount('end')).toBe(0);
  });

  it('start rejects with EndedBeforeReady for a client that has already ended', async () => {
    const { lifecycle, open } = setup({}, 'end');
    expectCode(await caught(lifecycle.start(open)), 'EndedBeforeReady');
  });

  it('start rejects with StartTimeout after startTimeoutMs', async () => {
    const { lifecycle, fake, open } = setup({ startTimeoutMs: 500 });
    const starting = caught(lifecycle.start(open));
    await vi.advanceTimersByTimeAsync(499);
    expect(lifecycle.state).toBe('starting');
    await vi.advanceTimersByTimeAsync(1);
    const error = await starting;
    expectCode(error, 'StartTimeout');
    expect((error as Error).message).toBe(
      'test: Redis was not ready within 500ms. Check that Redis is reachable, or raise startTimeoutMs.',
    );
    expect(lifecycle.state).toBe('idle');
    expect(fake.disconnects).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('start without startTimeoutMs keeps waiting and logs each connection error', async () => {
    const { lifecycle, logger, fake, open } = setup();
    let done = false;
    const starting = lifecycle.start(open).then(() => {
      done = true;
    });
    const refused = new Error('connect ECONNREFUSED');
    fake.emit('error', refused);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(done).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(refused, {
      adapter: 'test',
      connection: 'main',
    });
    fake.ready();
    await starting;
  });

  it('start rejects with Stopped when stop is called first, and closes the clients', async () => {
    const { lifecycle, fake, open } = setup({ startTimeoutMs: 5000 });
    const starting = caught(lifecycle.start(open));
    await lifecycle.stop();
    const error = await starting;
    expectCode(error, 'Stopped');
    expect((error as Error).message).toBe(
      'test: stop() was called before start() finished. Call start() again to connect.',
    );
    expect(fake.disconnects).toBe(1);
    expect(fake.listenerCount('ready')).toBe(0);
    expect(fake.listenerCount('end')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(lifecycle.state).toBe('stopped');
  });

  it('start rejects with Stopped when stop runs after the clients are ready and before start resolves', async () => {
    const { lifecycle, fake, open } = setup();
    const onReady = vi.fn();
    const starting = caught(lifecycle.start(open, onReady));
    fake.ready();
    const stopping = lifecycle.stop();
    expectCode(await starting, 'Stopped');
    await stopping;
    expect(onReady).not.toHaveBeenCalled();
    expect(lifecycle.state).toBe('stopped');
  });

  it('start during stop rejects with Stopped', async () => {
    const { lifecycle, open } = await started();
    const stopping = lifecycle.stop();
    const error = await caught(lifecycle.start(open));
    expectCode(error, 'Stopped');
    expect((error as Error).message).toBe(
      'test: stop() has not finished. Await stop() before start().',
    );
    await stopping;
  });

  it('start after stop opens new clients', async () => {
    const { lifecycle, fake } = await started();
    await lifecycle.stop();
    const next = new FakeRedis('ready');
    await lifecycle.start(() => ({ main: next.redis }));
    expect(lifecycle.state).toBe('ready');
    const seen = await lifecycle.run('get', async ({ main }) => main);
    expect(seen).toBe(next.redis);
    expect(seen).not.toBe(fake.redis);
    await lifecycle.stop();
    expect(next.quits).toBe(1);
  });
});

describe('run', () => {
  it('run rejects with NotStarted before start, without running the command', async () => {
    const { lifecycle } = setup();
    const command = vi.fn(async () => 'OK');
    const error = await caught(lifecycle.run('publish', command));
    expectCode(error, 'NotStarted');
    expect((error as Error).message).toBe(
      'test: not started. Call and await start() before publish().',
    );
    expect(command).not.toHaveBeenCalled();
  });

  it('run rejects with Starting while start is pending', async () => {
    const { lifecycle, open } = setup();
    void lifecycle.start(open).catch(() => undefined);
    const error = await caught(lifecycle.run('publish', async () => 'OK'));
    expectCode(error, 'Starting');
    expect((error as Error).message).toBe(
      'test: start() has not finished. Await start() before publish().',
    );
    await lifecycle.stop();
  });

  it('run rejects with Stopped during and after stop', async () => {
    const { lifecycle } = await started();
    const stopping = lifecycle.stop();
    const during = await caught(lifecycle.run('publish', async () => 'OK'));
    await stopping;
    const after = await caught(lifecycle.run('publish', async () => 'OK'));
    expectCode(during, 'Stopped');
    expectCode(after, 'Stopped');
    expect((after as Error).message).toBe(
      'test: stop() was called. Call start() again before publish().',
    );
  });

  it('a state error is a rejected promise, not a synchronous throw', () => {
    const { lifecycle } = setup();
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = lifecycle.run('publish', async () => 'OK');
    }).not.toThrow();
    return expect(pending).rejects.toMatchObject({ code: 'NotStarted' });
  });

  it('run passes the clients and returns the command result', async () => {
    const { lifecycle, fake } = await started();
    await expect(
      lifecycle.run('get', async ({ main }) => main === fake.redis),
    ).resolves.toBe(true);
  });

  it('run passes a command error through unchanged', async () => {
    const { lifecycle } = await started();
    const failure = new Error('WRONGTYPE');
    expect(
      await caught(
        lifecycle.run('get', async () => {
          throw failure;
        }),
      ),
    ).toBe(failure);
    expect(
      await caught(
        lifecycle.run('get', () => {
          throw failure;
        }),
      ),
    ).toBe(failure);
  });

  it('run rejects with StoppedBeforeReply when stop gives up before the command settles', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 300 });
    const reply = fake.command();
    const running = caught(lifecycle.run('publish', () => reply.promise));
    const stopping = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(300);
    await stopping;
    const error = await running;
    expectCode(error, 'StoppedBeforeReply');
    expect((error as Error).message).toBe(
      'test: stop() was called before Redis replied to publish(). Redis may or may not have run it. Check Redis before you retry.',
    );
    reply.resolve('late');
  });

  it('stop lets in-flight commands finish within the budget', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 1000 });
    const reply = fake.command();
    const running = lifecycle.run('publish', () => reply.promise);
    const stopping = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.quits).toBe(0);
    reply.resolve('1-0');
    await expect(running).resolves.toBe('1-0');
    await stopping;
    expect(fake.quits).toBe(1);
  });

  it('run rejects with the signal reason when its signal aborts first', async () => {
    const { lifecycle, fake } = await started();
    const abort = new AbortController();
    const reply = fake.command();
    const running = caught(
      lifecycle.run('read', () => reply.promise, { signal: abort.signal }),
    );
    const reason = new Error('unsubscribed');
    abort.abort(reason);
    expect(await running).toBe(reason);
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
    const command = vi.fn(async () => 'OK');
    expect(
      await caught(lifecycle.run('read', command, { signal: abort.signal })),
    ).toBe(reason);
    expect(command).not.toHaveBeenCalled();
  });

  it('run removes its signal listener when the command settles', async () => {
    const { lifecycle } = await started();
    const abort = new AbortController();
    for (let i = 0; i < 100; i += 1) {
      await lifecycle.run('get', async () => i, { signal: abort.signal });
      await caught(
        lifecycle.run(
          'get',
          async () => {
            throw new Error('no');
          },
          { signal: abort.signal },
        ),
      );
    }
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
  });

  it('assertReady throws the state error synchronously', async () => {
    const { lifecycle, fake, open } = setup();
    expect(() => lifecycle.assertReady('register')).toThrow(
      expect.objectContaining({ code: 'NotStarted' }),
    );
    const starting = lifecycle.start(open);
    expect(() => lifecycle.assertReady('register')).toThrow(
      expect.objectContaining({ code: 'Starting' }),
    );
    fake.ready();
    await starting;
    expect(() => lifecycle.assertReady('register')).not.toThrow();
    await lifecycle.stop();
    expect(() => lifecycle.assertReady('register')).toThrow(
      expect.objectContaining({ code: 'Stopped' }),
    );
  });
});

describe('stop', () => {
  it('cleanup runs before guarded commands are rejected, and can run guarded commands', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 1000 });
    const order: string[] = [];
    const inflight = fake.command();
    const running = caught(lifecycle.run('publish', () => inflight.promise));
    const stopping = lifecycle.stop(async ({ run, signal }) => {
      order.push(`cleanup aborted=${signal.aborted}`);
      const released = await run('release', async ({ main }) => {
        order.push('release ran');
        return main === fake.redis;
      });
      order.push(`released=${released}`);
    });
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    expectCode(await running, 'StoppedBeforeReply');
    expect(order).toEqual([
      'cleanup aborted=false',
      'release ran',
      'released=true',
    ]);
  });

  it('a guarded command in cleanup rejects with StoppedBeforeReply when the budget runs out', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 400 });
    const lock = fake.command();
    let released: unknown;
    let aborted = false;
    const stopping = lifecycle.stop(async ({ run, signal }) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      released = await caught(run('release', () => lock.promise));
    });
    await vi.advanceTimersByTimeAsync(400);
    await stopping;
    expect(aborted).toBe(true);
    expectCode(released, 'StoppedBeforeReply');
    expect(lifecycle.state).toBe('stopped');
  });

  it('cleanup that hangs is bounded by stopTimeoutMs', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 400 });
    let done = false;
    const stopping = lifecycle
      .stop(() => new Promise(() => {}))
      .then(() => {
        done = true;
      });
    await vi.advanceTimersByTimeAsync(399);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(fake.disconnects).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a cleanup error is logged and stop still closes the clients', async () => {
    const { lifecycle, logger, fake } = await started();
    const failure = new Error('release failed');
    await lifecycle.stop(() => {
      throw failure;
    });
    expect(logger.error).toHaveBeenCalledWith(failure, { adapter: 'test' });
    expect(fake.quits).toBe(1);
    expect(lifecycle.state).toBe('stopped');
  });

  it('cleanup does not run when stop cancels a pending start', async () => {
    const { lifecycle, open } = setup();
    const starting = caught(lifecycle.start(open));
    const cleanup = vi.fn();
    await lifecycle.stop(cleanup);
    await starting;
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('stop sends QUIT to a ready client', async () => {
    const { lifecycle, fake } = await started();
    await lifecycle.stop();
    expect(fake.quits).toBe(1);
    expect(fake.disconnects).toBe(0);
  });

  it('stop disconnects a client that is not ready, without QUIT', async () => {
    const { lifecycle, fake } = await started();
    fake.status = 'reconnecting';
    await lifecycle.stop();
    expect(fake.quits).toBe(0);
    expect(fake.disconnects).toBe(1);
  });

  it('stop disconnects a ready client whose QUIT does not settle in time', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 500 });
    fake.quitMode = 'hang';
    const stopping = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopping;
    expect(fake.quits).toBe(1);
    expect(fake.disconnects).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop logs a failed QUIT with its connection and disconnects', async () => {
    const { lifecycle, logger, fake } = await started();
    const blocking = new FakeRedis('ready');
    lifecycle.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => blocking.redis,
      fields: { topic: 'jobs' },
    });
    fake.quitMode = 'fail';
    blocking.quitMode = 'fail';
    await lifecycle.stop();
    expect(fake.disconnects).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(new Error('quit'), {
      adapter: 'test',
      connection: 'main',
    });
    expect(logger.error).toHaveBeenCalledWith(new Error('quit'), {
      topic: 'jobs',
      adapter: 'test',
      connection: 'blocking',
    });
  });

  it('stop skips QUIT when cleanup used the whole budget', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 200 });
    const stopping = lifecycle.stop(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(200);
    await stopping;
    expect(fake.quits).toBe(0);
    expect(fake.disconnects).toBe(1);
  });

  it('stop resolves while a client is reconnecting', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 500 });
    fake.status = 'reconnecting';
    await lifecycle.stop();
    expect(fake.status).toBe('reconnecting');
    expect(lifecycle.state).toBe('stopped');
  });

  it('guarded commands queued during an outage reject with StoppedBeforeReply on stop', async () => {
    const { lifecycle, fake } = await started({ stopTimeoutMs: 300 });
    fake.status = 'reconnecting';
    // ioredis never settles these after disconnect() on a reconnecting client.
    const queued = [1, 2, 3].map(() =>
      caught(lifecycle.run('publish', () => fake.command().promise)),
    );
    const stopping = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(300);
    await stopping;
    for (const error of await Promise.all(queued)) {
      expectCode(error, 'StoppedBeforeReply');
    }
  });

  it('concurrent stop calls share one stop and its cleanup', async () => {
    const { lifecycle, fake } = await started();
    const first = vi.fn();
    const second = vi.fn();
    const a = lifecycle.stop(first);
    const b = lifecycle.stop(second);
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(fake.quits).toBe(1);
  });

  it('stop leaves no timers', async () => {
    const { lifecycle, fake } = await started({
      stopTimeoutMs: 1000,
      startTimeoutMs: 5000,
    });
    fake.quitMode = 'hang';
    const inflight = caught(
      lifecycle.run('publish', () => fake.command().promise),
    );
    const stopping = lifecycle.stop(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    await inflight;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop returns listener counts to zero, except the lifetime error listener', async () => {
    const { lifecycle, fake, open } = setup({ startTimeoutMs: 1000 });
    const signal = new AbortController().signal;
    const starting = lifecycle.start(open);
    expect(fake.listenerCount('ready')).toBe(1);
    // The readiness wait's, and the one that logs an end after ready.
    expect(fake.listenerCount('end')).toBe(2);
    fake.ready();
    await starting;
    expect(fake.listenerCount('ready')).toBe(0);
    expect(fake.listenerCount('end')).toBe(1);
    const pending = caught(
      lifecycle.run('publish', () => fake.command().promise, { signal }),
    );
    expect(getEventListeners(signal, 'abort')).toHaveLength(1);
    const stopping = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    await pending;
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    expect(fake.listenerCount('ready')).toBe(0);
    expect(fake.listenerCount('end')).toBe(0);
    // ioredis prints "Unhandled error event" without it.
    expect(fake.listenerCount('error')).toBe(1);
  });

  it('a client error after stop is still logged, not left unhandled', async () => {
    const { lifecycle, logger, fake } = await started();
    await lifecycle.stop();
    const late = new Error('ECONNRESET');
    expect(() => fake.emit('error', late)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(late, {
      adapter: 'test',
      connection: 'main',
    });
  });
});

describe('attach and detach', () => {
  it('attach opens a client while ready, logs its errors with its fields, and stop closes it', async () => {
    const { lifecycle, logger } = await started();
    const blocking = new FakeRedis('ready');
    const client = lifecycle.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => blocking.redis,
      fields: { topic: 'jobs' },
    });
    expect(client).toBe(blocking.redis);
    const failure = new Error('ECONNRESET');
    blocking.emit('error', failure);
    expect(logger.error).toHaveBeenCalledWith(failure, {
      topic: 'jobs',
      adapter: 'test',
      connection: 'blocking',
    });
    await lifecycle.stop();
    expect(blocking.quits).toBe(1);
  });

  it('attach throws a state error and does not open when not ready', async () => {
    const { lifecycle } = setup();
    const open = vi.fn(() => new FakeRedis().redis);
    const attach = () =>
      lifecycle.attach({
        operation: 'subscribe',
        connection: 'blocking',
        open,
      });
    expect(attach).toThrow(
      expect.objectContaining({
        code: 'NotStarted',
        message:
          'test: not started. Call and await start() before subscribe().',
      }),
    );
    await lifecycle.stop();
    expect(attach).toThrow(expect.objectContaining({ code: 'Stopped' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('detach disconnects the client and stop leaves it alone', async () => {
    const { lifecycle } = await started();
    const blocking = new FakeRedis('ready');
    const client = lifecycle.attach({
      operation: 'subscribe',
      connection: 'blocking',
      open: () => blocking.redis,
    });
    lifecycle.detach(client);
    expect(blocking.disconnects).toBe(1);
    expect(blocking.quits).toBe(0);
    await lifecycle.stop();
    expect(blocking.disconnects).toBe(1);
    expect(blocking.quits).toBe(0);
  });
});

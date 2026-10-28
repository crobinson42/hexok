import { afterEach, describe, expect, it, vi } from 'vitest';

const published: unknown[][] = [];
const subs = new Map<string, Set<(channel: string, message: string) => void>>();

type Listener = (...args: unknown[]) => void;

class FakeRedis {
  static instances: FakeRedis[] = [];
  static readyOnOpen = true;
  readonly listeners = new Map<string, Set<Listener>>();
  status: string;
  connects = 0;
  disconnects = 0;

  constructor(...args: unknown[]) {
    const options = args.at(-1) as { lazyConnect?: boolean } | undefined;
    if (options?.lazyConnect) this.status = 'wait';
    else this.status = FakeRedis.readyOnOpen ? 'ready' : 'connecting';
    FakeRedis.instances.push(this);
  }

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    if (event === 'ready' || event === 'end') this.status = event;
    const set = this.listeners.get(event);
    if (!set) return false;
    for (const listener of [...set]) listener(...args);
    return true;
  }

  async connect(): Promise<void> {
    this.connects += 1;
    this.status = 'connecting';
    queueMicrotask(() => this.emit('ready'));
  }

  disconnect(): void {
    this.disconnects += 1;
    this.status = 'end';
  }

  async publish(channel: string, message: string): Promise<number> {
    published.push([channel, message]);
    let count = 0;
    for (const redis of FakeRedis.instances) {
      const handlers = redis.listeners.get('message');
      if (!handlers) continue;
      for (const handler of handlers) {
        handler(channel, message);
        count += 1;
      }
    }
    return count;
  }

  async subscribe(channel: string): Promise<void> {
    const set = subs.get(channel) ?? new Set();
    set.add(() => undefined);
    subs.set(channel, set);
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) subs.delete(channel);
  }

  async quit(): Promise<string> {
    return 'OK';
  }
}

vi.mock('ioredis', () => ({ Redis: FakeRedis, default: FakeRedis }));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function track(promise: Promise<void>) {
  const state = { settled: false, error: undefined as unknown };
  promise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

function lastPair(): [FakeRedis, FakeRedis] {
  const [publisher, subscriber] = FakeRedis.instances.slice(-2);
  if (!publisher || !subscriber) throw new Error('no redis clients opened');
  return [publisher, subscriber];
}

function sink(errors: unknown[]) {
  return {
    debug() {},
    info() {},
    warn() {},
    error(message: string | Error, fields?: Record<string, unknown>) {
      errors.push({ message, fields });
    },
  };
}

const { RedisBroadcast } = await import('./redis-broadcast.js');
const { channel } = await import('@hexok/broadcast');
const news = channel('news');

describe('RedisBroadcast', () => {
  it('rejects an encode failure before PUBLISH and logs a handler throw', async () => {
    published.length = 0;
    const errors: unknown[] = [];
    const bus = new RedisBroadcast({
      redis: 'redis://127.0.0.1:6379',
      encode: () => {
        throw new Error('bad encode');
      },
      logger: {
        debug() {},
        info() {},
        warn() {},
        error(message) {
          errors.push(message);
        },
      },
    });
    await bus.start();
    await expect(bus.publish(news, { a: 1 })).rejects.toThrow('bad encode');
    expect(published).toHaveLength(0);

    const live = new RedisBroadcast({
      redis: 'redis://127.0.0.1:6379',
      logger: {
        debug() {},
        info() {},
        warn() {},
        error(message) {
          errors.push(message);
        },
      },
    });
    await live.start();
    const seen: unknown[] = [];
    await live.subscribe(news, () => {
      throw new Error('handler');
    });
    await live.subscribe(news, async (message) => {
      seen.push(message.payload);
    });
    const started = Date.now();
    await live.publish(news, { ok: true });
    expect(Date.now() - started).toBeLessThan(1000);
    await vi.waitFor(() => {
      expect(seen).toEqual([{ ok: true }]);
    });
    expect(errors.some((error) => error instanceof Error)).toBe(true);
    expect(published[0]?.[0]).toBe('hexok:broadcast:news');
    await bus.stop();
    await live.stop();
  });

  describe('start', () => {
    afterEach(() => {
      FakeRedis.readyOnOpen = true;
    });

    it('stays pending until both connections are ready', async () => {
      FakeRedis.readyOnOpen = false;
      const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
      const state = track(bus.start());
      const [publisher, subscriber] = lastPair();
      await tick();
      expect(state.settled).toBe(false);
      publisher.emit('ready');
      await tick();
      expect(state.settled).toBe(false);
      subscriber.emit('ready');
      await tick();
      expect(state).toEqual({ settled: true, error: undefined });
      await bus.stop();
    });

    it('logs an error before ready and keeps waiting', async () => {
      FakeRedis.readyOnOpen = false;
      const errors: unknown[] = [];
      const bus = new RedisBroadcast({
        redis: 'redis://127.0.0.1:6379',
        logger: sink(errors),
      });
      const state = track(bus.start());
      const [publisher, subscriber] = lastPair();
      const refused = new Error('connect ECONNREFUSED');
      subscriber.emit('error', refused);
      await tick();
      expect(state.settled).toBe(false);
      expect(errors).toEqual([
        { message: refused, fields: { connection: 'subscriber' } },
      ]);
      publisher.emit('ready');
      subscriber.emit('ready');
      await tick();
      expect(state).toEqual({ settled: true, error: undefined });
      await bus.stop();
    });

    it('rejects on end, closes both clients, and can start again', async () => {
      FakeRedis.readyOnOpen = false;
      const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
      const first = bus.start();
      const [publisher, subscriber] = lastPair();
      publisher.emit('end');
      await expect(first).rejects.toThrow('ended before ready');
      expect(publisher.disconnects).toBe(1);
      expect(subscriber.disconnects).toBe(1);
      await expect(bus.publish(news, { a: 1 })).rejects.toThrow(
        'start() was not called',
      );

      FakeRedis.readyOnOpen = true;
      await bus.start();
      const [nextPublisher, nextSubscriber] = lastPair();
      expect(nextPublisher).not.toBe(publisher);
      expect(nextSubscriber).not.toBe(subscriber);
      await bus.publish(news, { a: 1 });
      await bus.stop();
    });

    it('connects a client created with lazyConnect', async () => {
      const bus = new RedisBroadcast({
        redis: { host: '127.0.0.1', lazyConnect: true },
      });
      await bus.start();
      const [publisher, subscriber] = lastPair();
      expect(publisher.connects).toBe(1);
      expect(subscriber.connects).toBe(1);
      await bus.stop();
    });
  });
});

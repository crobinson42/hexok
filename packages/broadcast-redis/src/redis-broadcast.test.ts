import { afterEach, describe, expect, it, vi } from 'vitest';

const published: unknown[][] = [];

type Listener = (...args: unknown[]) => void;

class FakeRedis {
  static instances: FakeRedis[] = [];
  static readyOnOpen = true;
  static holdSubscribes = false;
  readonly listeners = new Map<string, Set<Listener>>();
  readonly commands: string[][] = [];
  readonly held: { resolve: () => void; reject: (error: Error) => void }[] = [];
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
    const wrapped = Object.assign(
      (...args: unknown[]) => {
        this.off(event, wrapped);
        listener(...args);
      },
      { listener },
    );
    return this.on(event, wrapped);
  }

  off(event: string, listener: Listener): this {
    const set = this.listeners.get(event);
    if (!set) return this;
    for (const entry of set) {
      const original = (entry as { listener?: Listener }).listener;
      if (entry === listener || original === listener) set.delete(entry);
    }
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
    this.commands.push(['subscribe', channel]);
    if (!FakeRedis.holdSubscribes) return;
    await new Promise<void>((resolve, reject) => {
      this.held.push({ resolve, reject });
    });
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    this.commands.push(['unsubscribe', ...channels]);
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

    it('rejects a pending start on stop and removes its listeners', async () => {
      FakeRedis.readyOnOpen = false;
      const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
      const state = track(bus.start());
      const [publisher, subscriber] = lastPair();
      await bus.stop();
      await tick();
      expect(state.settled).toBe(true);
      expect(String(state.error)).toContain('stop() was called before ready');
      for (const redis of [publisher, subscriber]) {
        expect(redis.disconnects).toBe(1);
        expect(redis.listeners.get('ready')?.size ?? 0).toBe(0);
        expect(redis.listeners.get('end')?.size ?? 0).toBe(0);
      }
    });

    it('rejects start when stop is called after ready but before it resolves', async () => {
      FakeRedis.readyOnOpen = false;
      const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
      const started = bus.start();
      const [publisher, subscriber] = lastPair();
      publisher.emit('ready');
      subscriber.emit('ready');
      const stopped = bus.stop();
      await expect(started).rejects.toThrow('stop() was called before ready');
      await stopped;
      await expect(bus.publish(news, { a: 1 })).rejects.toThrow(
        'start() was not called',
      );
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

  describe('subscribe', () => {
    const wire = 'hexok:broadcast:news';

    afterEach(() => {
      FakeRedis.holdSubscribes = false;
    });

    it('makes a later subscriber wait for the in-flight SUBSCRIBE', async () => {
      FakeRedis.holdSubscribes = true;
      const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
      await bus.start();
      const [, subscriber] = lastPair();
      const first = track(bus.subscribe(news, () => {}));
      const second = track(bus.subscribe(news, () => {}));
      await tick();
      expect(second.settled).toBe(false);
      expect(subscriber.commands).toEqual([['subscribe', wire]]);
      subscriber.held[0]?.resolve();
      await tick();
      expect(first).toEqual({ settled: true, error: undefined });
      expect(second).toEqual({ settled: true, error: undefined });
      await bus.stop();
    });

    it('drops the handlers when SUBSCRIBE fails', async () => {
      FakeRedis.holdSubscribes = true;
      const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
      await bus.start();
      const [, subscriber] = lastPair();
      const seen: unknown[] = [];
      const first = bus.subscribe(news, (message) => {
        seen.push(message.payload);
      });
      const second = bus.subscribe(news, (message) => {
        seen.push(message.payload);
      });
      subscriber.held[0]?.reject(new Error('subscribe failed'));
      await expect(first).rejects.toThrow('subscribe failed');
      await expect(second).rejects.toThrow('subscribe failed');
      await bus.publish(news, { dropped: true });
      expect(seen).toEqual([]);

      const third = bus.subscribe(news, () => {});
      subscriber.held[1]?.resolve();
      await third;
      await bus.stop();
      expect(subscriber.commands).toEqual([
        ['subscribe', wire],
        ['subscribe', wire],
        ['unsubscribe', wire],
      ]);
    });

    it('keeps command order when unsubscribe races an in-flight SUBSCRIBE', async () => {
      FakeRedis.holdSubscribes = true;
      const bus = new RedisBroadcast({ redis: 'redis://127.0.0.1:6379' });
      await bus.start();
      const [, subscriber] = lastPair();
      const handler = () => {};
      const first = bus.subscribe(news, handler);
      await bus.unsubscribe(news, handler);
      const seen: unknown[] = [];
      const second = bus.subscribe(news, (message) => {
        seen.push(message.payload);
      });
      expect(subscriber.commands).toEqual([
        ['subscribe', wire],
        ['unsubscribe', wire],
        ['subscribe', wire],
      ]);
      subscriber.held[0]?.resolve();
      subscriber.held[1]?.resolve();
      await Promise.all([first, second]);
      await bus.publish(news, { n: 2 });
      expect(seen).toEqual([{ n: 2 }]);
      await bus.stop();
    });
  });
});

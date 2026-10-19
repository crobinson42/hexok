import { describe, expect, it, vi } from 'vitest';

const published: unknown[][] = [];
const subs = new Map<string, Set<(channel: string, message: string) => void>>();

class FakeRedis {
  static instances: FakeRedis[] = [];
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(..._args: unknown[]) {
    FakeRedis.instances.push(this);
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
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

const { RedisBroadcast } = await import('./redis-broadcast.js');

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
    await expect(bus.publish('news', { a: 1 })).rejects.toThrow('bad encode');
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
    await live.subscribe('news', () => {
      throw new Error('handler');
    });
    await live.subscribe('news', async (message) => {
      seen.push(message.payload);
    });
    const started = Date.now();
    await live.publish('news', { ok: true });
    expect(Date.now() - started).toBeLessThan(1000);
    await vi.waitFor(() => {
      expect(seen).toEqual([{ ok: true }]);
    });
    expect(errors.some((error) => error instanceof Error)).toBe(true);
    expect(published[0]?.[0]).toBe('hexok:broadcast:news');
    await bus.stop();
    await live.stop();
  });
});

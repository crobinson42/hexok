import { randomUUID } from 'node:crypto';
import { channel } from '@hexok/broadcast';
import { describeRedisLifecycle, RedisProxy } from '@hexok/test-redis';
import type { RedisOptions } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { RedisBroadcast } from './redis-broadcast.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

/** Each bus gets its own prefix, because Redis pub/sub is shared by every test run on the server. */
function prefix(): string {
  return `hexok:broadcast:it:${randomUUID()}:`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`still pending after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describeRedisLifecycle('RedisBroadcast', ({ redis, stopTimeoutMs }) => {
  const bus = new RedisBroadcast({
    redis,
    stopTimeoutMs,
    channelPrefix: prefix(),
  });
  const news = channel<{ n: number }>('news');
  return {
    start: () => bus.start(),
    stop: () => bus.stop(),
    operate: () => bus.publish(news, { n: 1 }),
  };
});

describe.skipIf(!process.env.REDIS_URL)('RedisBroadcast integration', () => {
  const buses: RedisBroadcast[] = [];
  const proxies: RedisProxy[] = [];

  afterEach(async () => {
    await Promise.all(buses.splice(0).map((bus) => bus.stop()));
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  });

  async function proxied(): Promise<RedisProxy> {
    const proxy = await RedisProxy.start();
    proxies.push(proxy);
    return proxy;
  }

  it('delivers across two instances and does not wait on handlers', async () => {
    const url = process.env.REDIS_URL ?? '';
    const channelPrefix = prefix();
    const publisher = new RedisBroadcast({ redis: url, channelPrefix });
    const subscriber = new RedisBroadcast({ redis: url, channelPrefix });
    buses.push(publisher, subscriber);
    await publisher.start();
    await subscriber.start();
    const news = channel<{ n: number }>('news');
    const seen: unknown[] = [];
    await subscriber.subscribe(news, async (message) => {
      seen.push({ channel: message.channel, payload: message.payload });
      await delay(50);
    });
    const started = Date.now();
    await publisher.publish(news, { n: 1 });
    expect(Date.now() - started).toBeLessThan(40);
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) {
      await delay(20);
    }
    expect(seen).toEqual([{ channel: 'news', payload: { n: 1 } }]);
  });

  it('rejects a pending start when stop is called while Redis is down', async () => {
    const proxy = await proxied();
    await proxy.refuse();
    const bus = new RedisBroadcast({
      redis: { host: proxy.host, port: proxy.port },
    });
    const started = bus.start();
    await delay(200);
    await bus.stop();
    await expect(within(started, 1000)).rejects.toMatchObject({
      code: 'Stopped',
    });
  });

  it('rejects start when stop follows it', async () => {
    const url = process.env.REDIS_URL ?? '';
    for (let run = 0; run < 50; run += 1) {
      const bus = new RedisBroadcast({ redis: url });
      const started = bus.start();
      await bus.stop();
      await expect(started).rejects.toMatchObject({ code: 'Stopped' });
    }
  });

  it('delivers to a subscriber that joins an in-flight SUBSCRIBE', async () => {
    const url = process.env.REDIS_URL ?? '';
    const bus = new RedisBroadcast({ redis: url, channelPrefix: prefix() });
    buses.push(bus);
    await bus.start();
    for (let run = 0; run < 50; run += 1) {
      const news = channel<number>(`news-${run}`);
      const seen: unknown[] = [];
      const first = bus.subscribe(news, () => {});
      await bus.subscribe(news, (message) => {
        seen.push(message.payload);
      });
      await bus.publish(news, run);
      await first;
      const deadline = Date.now() + 1000;
      while (seen.length === 0 && Date.now() < deadline) {
        await delay(5);
      }
      expect(seen).toEqual([run]);
    }
  });

  it('stops while Redis is unreachable after subscribing', async () => {
    const proxy = await proxied();
    const bus = new RedisBroadcast({
      redis: { host: proxy.host, port: proxy.port },
      channelPrefix: prefix(),
    });
    buses.push(bus);
    await bus.start();
    await bus.subscribe(channel('news'), () => {});
    await proxy.refuse();
    proxy.drop();
    await delay(100);
    await within(bus.stop(), 1000);
  });

  it('rejects a subscribe queued during an outage with StoppedBeforeReply on stop', async () => {
    const proxy = await proxied();
    const bus = new RedisBroadcast({
      redis: { host: proxy.host, port: proxy.port },
      channelPrefix: prefix(),
      stopTimeoutMs: 200,
    });
    buses.push(bus);
    await bus.start();
    await proxy.refuse();
    proxy.drop();
    await delay(100);
    const subscribing = bus
      .subscribe(channel('news'), () => {})
      .catch((error: unknown) => error);
    await within(bus.stop(), 1000);
    expect(await within(subscribing, 1000)).toMatchObject({
      code: 'StoppedBeforeReply',
    });
  });

  async function startSubscribePublish(
    redis: string | RedisOptions,
  ): Promise<void> {
    const bus = new RedisBroadcast({ redis, channelPrefix: prefix() });
    buses.push(bus);
    await bus.start();
    const news = channel<{ n: number }>('news');
    const seen: unknown[] = [];
    await bus.subscribe(news, (message) => {
      seen.push(message.payload);
    });
    await bus.publish(news, { n: 1 });
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) {
      await delay(5);
    }
    expect(seen).toEqual([{ n: 1 }]);
    await bus.stop();
  }

  it('delivers a message published after subscribe resolves', async () => {
    const url = process.env.REDIS_URL ?? '';
    for (let run = 0; run < 50; run += 1) {
      await startSubscribePublish(url);
    }
  });

  it('subscribes right after start without the offline queue', async () => {
    const url = new URL(process.env.REDIS_URL ?? '');
    const redis: RedisOptions = {
      host: url.hostname,
      port: Number(url.port || 6379),
      enableOfflineQueue: false,
    };
    for (let run = 0; run < 50; run += 1) {
      await startSubscribePublish(redis);
    }
  });
});

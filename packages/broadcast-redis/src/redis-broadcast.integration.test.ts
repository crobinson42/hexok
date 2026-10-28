import { randomUUID } from 'node:crypto';
import { channel } from '@hexok/broadcast';
import type { RedisOptions } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { RedisBroadcast } from './redis-broadcast.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

describe.skipIf(!process.env.REDIS_URL)('RedisBroadcast integration', () => {
  const buses: RedisBroadcast[] = [];

  afterEach(async () => {
    await Promise.all(buses.splice(0).map((bus) => bus.stop()));
  });

  it('delivers across two instances and does not wait on handlers', async () => {
    const url = process.env.REDIS_URL ?? '';
    const prefix = `hexok:broadcast:it:${randomUUID()}:`;
    const publisher = new RedisBroadcast({ redis: url, channelPrefix: prefix });
    const subscriber = new RedisBroadcast({
      redis: url,
      channelPrefix: prefix,
    });
    buses.push(publisher, subscriber);
    await publisher.start();
    await subscriber.start();
    const news = channel<{ n: number }>('news');
    const seen: unknown[] = [];
    await subscriber.subscribe(news, async (message) => {
      seen.push({ channel: message.channel, payload: message.payload });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const started = Date.now();
    await publisher.publish(news, { n: 1 });
    expect(Date.now() - started).toBeLessThan(40);
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(seen).toEqual([{ channel: 'news', payload: { n: 1 } }]);
  });

  async function startSubscribePublish(
    redis: string | RedisOptions,
  ): Promise<void> {
    const prefix = `hexok:broadcast:it:${randomUUID()}:`;
    const bus = new RedisBroadcast({ redis, channelPrefix: prefix });
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
      await new Promise((resolve) => setTimeout(resolve, 5));
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

import { randomUUID } from 'node:crypto';
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
    const seen: unknown[] = [];
    await subscriber.subscribe('news', async (message) => {
      seen.push({ channel: message.channel, payload: message.payload });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const started = Date.now();
    await publisher.publish('news', { n: 1 });
    expect(Date.now() - started).toBeLessThan(40);
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(seen).toEqual([{ channel: 'news', payload: { n: 1 } }]);
  });
});

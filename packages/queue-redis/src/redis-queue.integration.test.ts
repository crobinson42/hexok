import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { RedisQueue } from './redis-queue.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

async function waitFor(check: () => Promise<boolean> | boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for queue condition');
}

describe.skipIf(!process.env.REDIS_URL)('RedisQueue integration', () => {
  const open: Redis[] = [];
  const queues: RedisQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    await Promise.all(open.splice(0).map((redis) => redis.quit()));
  });

  it('acks void and drop, leaves retry pending, and skips XACK after unsubscribe and stop', async () => {
    const url = process.env.REDIS_URL ?? '';
    const probe = new Redis(url);
    open.push(probe);
    const prefix = `hexok:queue:it:${randomUUID()}:`;
    const queue = new RedisQueue({
      redis: url,
      keyPrefix: prefix,
      visibilityMs: 5000,
      blockMs: 200,
      retentionMs: 86_400_000,
    });
    queues.push(queue);
    await queue.start();
    const seen: string[] = [];
    let mode: 'ack' | 'void' | 'drop' | 'retry' | 'hold' = 'ack';
    let release: (value: 'ack') => void = () => {};
    await queue.subscribe('jobs', {
      consumerGroup: 'workers',
      handler: async (message) => {
        seen.push(String(message.payload));
        if (mode === 'hold') {
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        if (mode === 'void') return;
        return mode;
      },
    });
    const key = `${prefix}jobs`;
    const pending = async () => {
      const summary = (await probe.xpending(key, 'workers')) as [
        number,
        ...unknown[],
      ];
      return summary[0];
    };

    await queue.publish('jobs', 'acked');
    await waitFor(
      async () => seen.includes('acked') && (await pending()) === 0,
    );

    mode = 'void';
    await queue.publish('jobs', 'voided');
    await waitFor(
      async () => seen.includes('voided') && (await pending()) === 0,
    );

    mode = 'drop';
    await queue.publish('jobs', 'dropped');
    await waitFor(
      async () => seen.includes('dropped') && (await pending()) === 0,
    );

    mode = 'retry';
    await queue.publish('jobs', 'retried');
    await waitFor(
      async () => seen.includes('retried') && (await pending()) === 1,
    );

    mode = 'hold';
    await queue.publish('jobs', 'held');
    await waitFor(async () => seen.includes('held'));
    await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
    release('ack');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await pending()).toBe(2);

    const queue2 = new RedisQueue({
      redis: url,
      keyPrefix: prefix,
      visibilityMs: 300,
      blockMs: 200,
    });
    queues.push(queue2);
    await queue2.start();
    let releaseStop: (value: 'ack') => void = () => {};
    await queue2.subscribe('jobs', {
      consumerGroup: 'workers',
      handler: () =>
        new Promise((resolve) => {
          releaseStop = resolve;
        }),
    });
    await queue2.publish('jobs', 'stopping');
    await waitFor(async () => (await pending()) >= 2);
    const stopping = queue2.stop();
    releaseStop('ack');
    await stopping;
    expect(await pending()).toBeGreaterThanOrEqual(2);

    const before = await probe.xlen(`${prefix}encoded`);
    const broken = new RedisQueue({
      redis: url,
      keyPrefix: prefix,
      encode: () => {
        throw new Error('bad encode');
      },
    });
    queues.push(broken);
    await broken.start();
    await expect(broken.publish('encoded', { a: 1 })).rejects.toThrow(
      'bad encode',
    );
    expect(await probe.xlen(`${prefix}encoded`)).toBe(before);
  });

  it('removes the local consumer on unsubscribe and leaves the group', async () => {
    const url = process.env.REDIS_URL ?? '';
    const probe = new Redis(url);
    open.push(probe);
    const prefix = `hexok:queue:it:${randomUUID()}:`;
    const queue = new RedisQueue({
      redis: url,
      keyPrefix: prefix,
      visibilityMs: 5000,
      blockMs: 200,
    });
    queues.push(queue);
    await queue.start();
    await queue.subscribe('jobs', {
      consumerGroup: 'workers',
      handler: async () => 'ack',
    });
    const key = `${prefix}jobs`;
    await waitFor(async () => {
      const consumers = (await probe.xinfo(
        'CONSUMERS',
        key,
        'workers',
      )) as unknown[];
      return consumers.length === 1;
    });
    await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
    expect(await probe.xinfo('CONSUMERS', key, 'workers')).toEqual([]);
    const groups = (await probe.xinfo('GROUPS', key)) as unknown[];
    expect(groups).toHaveLength(1);
    expect(await probe.exists(key)).toBe(1);
  });
});

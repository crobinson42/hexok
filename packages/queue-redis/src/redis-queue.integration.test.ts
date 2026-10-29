import { randomUUID } from 'node:crypto';
import type { QueueMaxDeliveries, QueueSubscribeOptions } from '@hexok/queue';
import { describeRedisLifecycle, RedisProxy, runNode } from '@hexok/test-redis';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import type { ParkInput } from './park.js';
import { RedisQueue } from './redis-queue.js';
import {
  deleteIdleStream,
  destroyIdleGroup,
  releaseConsumer,
} from './scripts.js';

describeRedisLifecycle('RedisQueue', ({ redis, stopTimeoutMs }) => {
  const queue = new RedisQueue({
    redis,
    stopTimeoutMs,
    keyPrefix: `hexok:queue:it:${randomUUID()}:`,
  });
  return {
    start: () => queue.start(),
    stop: () => queue.stop(),
    operate: () => queue.publish('jobs', { n: 1 }),
    // The suite calls stop() as soon as this returns, so the work must already be under way.
    inFlight: () => queue.publish('jobs', { n: 2 }),
  };
});

function subscribe<T>(
  queue: {
    subscribe: (
      topic: string,
      options: QueueSubscribeOptions<T>,
    ) => Promise<void>;
  },
  topic: string,
  options: Omit<QueueSubscribeOptions<T>, 'maxDeliveries'> & {
    readonly maxDeliveries?: QueueMaxDeliveries;
  },
): Promise<void> {
  const maxDeliveries = options.maxDeliveries ?? 'unlimited';
  return queue.subscribe(topic, {
    consumerGroup: options.consumerGroup,
    handler: options.handler,
    maxDeliveries,
    ...(options.startFrom === undefined
      ? {}
      : { startFrom: options.startFrom }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
}

async function waitFor(check: () => Promise<boolean> | boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for queue condition');
}

const queueEntry = new URL('./redis-queue.ts', import.meta.url).href;

/** Runs `body` in a child Node with `RedisQueue` in scope. */
function runQueue(
  body: string,
  env: Record<string, string> = {},
  exposeGc = false,
) {
  return runNode(
    `const { RedisQueue } = await import(${JSON.stringify(queueEntry)});\n${body}`,
    { env, exposeGc },
  );
}

function newPrefix(): string {
  return `hexok:queue:it:${randomUUID()}:`;
}

/** Consumer names and pending counts of `group`. */
async function consumersOf(
  probe: Redis,
  key: string,
  group: string,
): Promise<Array<{ name: string; pending: number }>> {
  const rows = (await probe.xinfo('CONSUMERS', key, group)) as unknown[][];
  return rows.map((row) => ({
    name: String(row[1]),
    pending: Number(row[3]),
  }));
}

describe.skipIf(!process.env.REDIS_URL)('RedisQueue integration', () => {
  const open: Redis[] = [];
  const queues: RedisQueue[] = [];
  const proxies: RedisProxy[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    await Promise.all(open.splice(0).map((redis) => redis.quit()));
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  });

  function probe(): Redis {
    const client = new Redis(process.env.REDIS_URL ?? '');
    open.push(client);
    return client;
  }

  /** A started queue behind its own outage proxy. */
  async function proxied(
    keyPrefix: string,
    stopTimeoutMs: number,
  ): Promise<{ queue: RedisQueue; proxy: RedisProxy }> {
    const proxy = await RedisProxy.start();
    proxies.push(proxy);
    const queue = new RedisQueue({
      redis: { host: proxy.host, port: proxy.port, disconnectTimeout: 100 },
      keyPrefix,
      blockMs: 200,
      stopTimeoutMs,
    });
    queues.push(queue);
    await queue.start();
    return { queue, proxy };
  }

  it('acks void and drop, leaves retry pending, and skips XACK once unsubscribe and stop stop waiting', async () => {
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
      stopTimeoutMs: 200,
    });
    queues.push(queue);
    await queue.start();
    const seen: string[] = [];
    let mode: 'ack' | 'void' | 'drop' | 'retry' | 'hold' = 'ack';
    let release: (value: 'ack') => void = () => {};
    await subscribe(queue, 'jobs', {
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
      stopTimeoutMs: 200,
    });
    queues.push(queue2);
    await queue2.start();
    let releaseStop: (value: 'ack') => void = () => {};
    await subscribe(queue2, 'jobs', {
      consumerGroup: 'workers',
      handler: () =>
        new Promise((resolve) => {
          releaseStop = resolve;
        }),
    });
    await queue2.publish('jobs', 'stopping');
    await waitFor(async () => (await pending()) >= 2);
    await queue2.stop();
    releaseStop('ack');
    await new Promise((resolve) => setTimeout(resolve, 100));
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

  it('lets the process exit after stop with the default visibility', async () => {
    const result = await runQueue(
      `
const queue = new RedisQueue({
  redis: process.env.REDIS_URL,
  keyPrefix: process.env.KEY_PREFIX,
});
await queue.start();
await queue.publish('jobs', { n: 1 });
await queue.stop();
`,
      { KEY_PREFIX: `hexok:queue:it:${randomUUID()}:` },
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(3000);
  });

  it('marks a sensitive entry and still delivers its payload', async () => {
    const url = process.env.REDIS_URL ?? '';
    const probe = new Redis(url);
    open.push(probe);
    const prefix = `hexok:queue:it:${randomUUID()}:`;
    const queue = new RedisQueue({
      redis: url,
      keyPrefix: prefix,
      blockMs: 200,
    });
    queues.push(queue);
    await queue.start();
    const seen: unknown[] = [];
    await subscribe(queue, 'codes', {
      consumerGroup: 'sms',
      handler: async (message) => {
        seen.push(message.payload);
      },
    });
    await queue.publish('codes', { code: '4821' }, { sensitive: true });
    await queue.publish('codes', { code: 'public' });
    await waitFor(() => seen.length === 2);
    expect(seen).toEqual([{ code: '4821' }, { code: 'public' }]);
    const entries = await probe.xrange(`${prefix}codes`, '-', '+');
    expect(entries.map(([, fields]) => fields)).toEqual([
      ['payload', '{"code":"4821"}', 'sensitive', '1'],
      ['payload', '{"code":"public"}'],
    ]);
  });

  it('throws a sensitive XADD failure without the command args', async () => {
    const url = process.env.REDIS_URL ?? '';
    const probe = new Redis(url);
    open.push(probe);
    const prefix = `hexok:queue:it:${randomUUID()}:`;
    await probe.set(`${prefix}codes`, 'not a stream');
    const queue = new RedisQueue({ redis: url, keyPrefix: prefix });
    queues.push(queue);
    await queue.start();
    const secret = { code: 'SECRET-9999' };

    const sensitive = await queue
      .publish('codes', secret, { sensitive: true })
      .catch((error: unknown) => error);
    expect(sensitive).toBeInstanceOf(Error);
    expect(sensitive).toMatchObject({
      name: 'ReplyError',
      message: expect.stringMatching(/^WRONGTYPE/),
    });
    expect(sensitive).not.toHaveProperty('command');
    expect(JSON.stringify(sensitive)).not.toContain('SECRET-9999');

    const plain = await queue
      .publish('codes', secret)
      .catch((error: unknown) => error);
    expect(plain).toHaveProperty('command.name', 'xadd');
    await probe.del(`${prefix}codes`);
  });

  it('lets the process exit soon after stop with a short disconnectTimeout when Redis is unreachable', async () => {
    const result = await runQueue(
      `
const queue = new RedisQueue({
  redis: { host: '127.0.0.1', port: 1, disconnectTimeout: 100 },
});
const starting = queue.start().catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 300));
await queue.stop();
await starting;
`,
      {},
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(1500);
  });

  it('stops promptly when Redis goes away under an idle subscription', async () => {
    const result = await runQueue(
      `
const { RedisProxy } = await import('@hexok/test-redis');
const proxy = await RedisProxy.start();
const queue = new RedisQueue({
  redis: { host: proxy.host, port: proxy.port, disconnectTimeout: 100 },
  keyPrefix: process.env.KEY_PREFIX,
  blockMs: 200,
});
await queue.start();
await queue.subscribe('jobs', { consumerGroup: 'workers', maxDeliveries: 'unlimited', handler: async () => 'ack' });
await new Promise((resolve) => setTimeout(resolve, 100));
await proxy.refuse();
proxy.drop();
await new Promise((resolve) => setTimeout(resolve, 300));
const stopping = Date.now();
await queue.stop();
console.log(JSON.stringify({ stopMs: Date.now() - stopping, stoppedAt: Date.now() }));
await proxy.close();
`,
      { KEY_PREFIX: `hexok:queue:it:${randomUUID()}:` },
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const { stopMs, stoppedAt } = JSON.parse(result.stdout) as {
      stopMs: number;
      stoppedAt: number;
    };
    expect(stopMs).toBeLessThan(500);
    expect(result.exitedAt - stoppedAt).toBeLessThan(1000);
  });

  it('keeps a consumer that owns a pending entry on unsubscribe', async () => {
    const url = process.env.REDIS_URL ?? '';
    const probe = new Redis(url);
    open.push(probe);
    const prefix = `hexok:queue:it:${randomUUID()}:`;
    const queue = new RedisQueue({
      redis: url,
      keyPrefix: prefix,
      blockMs: 200,
    });
    queues.push(queue);
    await queue.start();
    let handled = 0;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      handler: async () => {
        handled += 1;
        return 'retry';
      },
    });
    await queue.publish('jobs', 'kept');
    await waitFor(() => handled === 1);
    const key = `${prefix}jobs`;
    await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
    const consumers = (await probe.xinfo(
      'CONSUMERS',
      key,
      'workers',
    )) as unknown[][];
    expect(consumers).toHaveLength(1);
    expect(consumers[0]?.slice(0, 4)).toEqual([
      'name',
      expect.stringMatching(/^hexok:/),
      'pending',
      1,
    ]);
  });

  it('does not hold delivered payloads after their handlers finish', async () => {
    const result = await runQueue(
      `
const { Redis } = await import('ioredis');
const count = 2000;
const payload = JSON.stringify('x'.repeat(16_000));
const admin = new Redis(process.env.REDIS_URL);
const key = process.env.KEY_PREFIX + 'jobs';
for (let i = 0; i < count; i += 500) {
  const pipeline = admin.pipeline();
  for (let j = 0; j < 500; j += 1) pipeline.xadd(key, '*', 'payload', payload);
  await pipeline.exec();
}
const queue = new RedisQueue({
  redis: process.env.REDIS_URL,
  keyPrefix: process.env.KEY_PREFIX,
  maxLen: 1e9,
});
await queue.start();
const before = heapUsed();
let handled = 0;
await queue.subscribe('jobs', {
  consumerGroup: 'workers',
  maxDeliveries: 'unlimited',
  handler: async () => {
    handled += 1;
  },
});
while (handled < count) await new Promise((resolve) => setTimeout(resolve, 20));
await new Promise((resolve) => setTimeout(resolve, 50));
const growth = heapUsed() - before;
await queue.stop();
await admin.del(key);
await admin.quit();
console.log(JSON.stringify({ growth, total: count * payload.length }));
`,
      { KEY_PREFIX: `hexok:queue:it:${randomUUID()}:` },
      true,
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const { growth, total } = JSON.parse(result.stdout) as {
      growth: number;
      total: number;
    };
    expect(total).toBeGreaterThan(30_000_000);
    expect(growth).toBeLessThan(total / 10);
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
    await subscribe(queue, 'jobs', {
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
  it('handles each entry of a read batch once while the batch outlasts visibilityMs', async () => {
    const keyPrefix = newPrefix();
    const admin = probe();
    for (let n = 0; n < 10; n += 1) {
      await admin.xadd(`${keyPrefix}jobs`, '*', 'payload', String(n));
    }
    const queue = new RedisQueue({
      redis: process.env.REDIS_URL ?? '',
      keyPrefix,
      visibilityMs: 1000,
      blockMs: 200,
      batch: 10,
    });
    queues.push(queue);
    await queue.start();
    const calls: string[] = [];
    let running = 0;
    let most = 0;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      startFrom: 'earliest',
      handler: async (message) => {
        calls.push(message.id);
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 400));
        running -= 1;
      },
    });
    await waitFor(() => new Set(calls).size === 10);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect({ calls: calls.length, most }).toEqual({ calls: 10, most: 1 });
  });

  it('stop acks a handler that finishes within stopTimeoutMs', async () => {
    const keyPrefix = newPrefix();
    const admin = probe();
    const queue = new RedisQueue({
      redis: process.env.REDIS_URL ?? '',
      keyPrefix,
      blockMs: 200,
      stopTimeoutMs: 2000,
    });
    queues.push(queue);
    await queue.start();
    let started = false;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      handler: async () => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
    });
    await queue.publish('jobs', 'deploy');
    await waitFor(() => started);
    await queue.stop();
    const summary = (await admin.xpending(`${keyPrefix}jobs`, 'workers')) as [
      number,
    ];
    expect(summary[0]).toBe(0);
    expect(await consumersOf(admin, `${keyPrefix}jobs`, 'workers')).toEqual([]);
  });

  it('a publish queued while Redis refuses connections rejects with StoppedBeforeReply on stop', async () => {
    const { queue, proxy } = await proxied(newPrefix(), 500);
    await proxy.refuse();
    proxy.drop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const publishing = queue
      .publish('jobs', { n: 1 })
      .catch((error: unknown) => error);
    const started = Date.now();
    await queue.stop();
    expect(Date.now() - started).toBeLessThan(750);
    expect(await publishing).toMatchObject({ code: 'StoppedBeforeReply' });
  });

  it('unsubscribe resolves within stopTimeoutMs while Redis is blackholed, and the group can subscribe again', async () => {
    const keyPrefix = newPrefix();
    const admin = probe();
    const { queue, proxy } = await proxied(keyPrefix, 500);
    const options = {
      consumerGroup: 'workers',
      handler: async () => 'ack' as const,
    };
    await subscribe(queue, 'jobs', options);
    await waitFor(
      async () =>
        (await consumersOf(admin, `${keyPrefix}jobs`, 'workers')).length === 1,
    );
    proxy.blackhole();
    const started = Date.now();
    await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
    const ms = Date.now() - started;
    expect(ms).toBeGreaterThanOrEqual(450);
    expect(ms).toBeLessThan(750);
    await proxy.restore();
    await subscribe(queue, 'jobs', options);
  });

  it('unsubscribe resolves within stopTimeoutMs while Redis refuses connections', async () => {
    const keyPrefix = newPrefix();
    const admin = probe();
    const { queue, proxy } = await proxied(keyPrefix, 500);
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      handler: async () => 'ack',
    });
    await waitFor(
      async () =>
        (await consumersOf(admin, `${keyPrefix}jobs`, 'workers')).length === 1,
    );
    await proxy.refuse();
    proxy.drop();
    const started = Date.now();
    await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
    expect(Date.now() - started).toBeLessThan(750);
  });

  it('a consumer that owns a pending entry survives unsubscribe, stop, and maintain', async () => {
    const keyPrefix = newPrefix();
    const admin = probe();
    const queue = new RedisQueue({
      redis: process.env.REDIS_URL ?? '',
      keyPrefix,
      blockMs: 200,
    });
    queues.push(queue);
    await queue.start();
    let handled = 0;
    for (const topic of ['left', 'stopped']) {
      await subscribe(queue, topic, {
        consumerGroup: 'workers',
        handler: async () => {
          handled += 1;
          return 'retry';
        },
      });
      await queue.publish(topic, topic);
    }
    await waitFor(() => handled === 2);
    await queue.unsubscribe('left', { consumerGroup: 'workers' });
    await queue.stop();

    const maintainer = new RedisQueue({
      redis: process.env.REDIS_URL ?? '',
      keyPrefix,
    });
    queues.push(maintainer);
    await maintainer.start();
    const report = await maintainer.maintain({
      dryRun: false,
      idleConsumerMs: 0,
    });
    expect(report.consumersRemoved).toEqual([]);
    for (const topic of ['left', 'stopped']) {
      expect(
        await consumersOf(admin, `${keyPrefix}${topic}`, 'workers'),
      ).toEqual([{ name: expect.stringMatching(/^hexok:/), pending: 1 }]);
    }
  });

  it('stop and maintain remove an idle consumer that owns nothing', async () => {
    const keyPrefix = newPrefix();
    const admin = probe();
    const key = `${keyPrefix}jobs`;
    const queue = new RedisQueue({
      redis: process.env.REDIS_URL ?? '',
      keyPrefix,
      blockMs: 200,
    });
    queues.push(queue);
    await queue.start();
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      handler: async () => 'ack',
    });
    await waitFor(
      async () => (await consumersOf(admin, key, 'workers')).length === 1,
    );
    await queue.stop();
    expect(await consumersOf(admin, key, 'workers')).toEqual([]);

    // A consumer left by a process that died owns nothing and is idle.
    await admin.xreadgroup(
      'GROUP',
      'workers',
      'hexok:dead:1',
      'COUNT',
      1,
      'STREAMS',
      key,
      '>',
    );
    await queue.start();
    const report = await queue.maintain({ dryRun: false, idleConsumerMs: 0 });
    expect(report.consumersRemoved).toEqual([
      {
        topic: 'jobs',
        group: 'workers',
        consumer: 'hexok:dead:1',
        idleMs: expect.any(Number),
      },
    ]);
    expect(await consumersOf(admin, key, 'workers')).toEqual([]);
  });

  it('the group script destroys a group only while it has no consumers and nothing pending', async () => {
    const admin = probe();
    const key = `${newPrefix()}jobs`;
    await admin.xgroup('CREATE', key, 'busy', '0', 'MKSTREAM');
    await admin.xgroup('CREATE', key, 'idle', '0');
    await admin.xadd(key, '*', 'payload', '1');
    await admin.xreadgroup(
      'GROUP',
      'busy',
      'hexok:1',
      'COUNT',
      1,
      'STREAMS',
      key,
      '>',
    );
    expect(await destroyIdleGroup(admin, key, 'busy')).toBe('kept');
    expect(await destroyIdleGroup(admin, key, 'idle')).toBe('removed');
    expect(await destroyIdleGroup(admin, key, 'idle')).toBe('gone');
    expect(await destroyIdleGroup(admin, `${key}:missing`, 'idle')).toBe(
      'gone',
    );
    const groups = (await admin.xinfo('GROUPS', key)) as unknown[][];
    expect(groups.map((group) => group[1])).toEqual(['busy']);
    await admin.del(key);
  });

  it('the stream script deletes a stream only while it has no groups and its last id is old', async () => {
    const admin = probe();
    const prefix = newPrefix();
    const old = Date.now() - 60_000;
    const idleMs = 1000;
    const grouped = `${prefix}grouped`;
    const fresh = `${prefix}fresh`;
    const idle = `${prefix}idle`;
    await admin.xadd(grouped, `${old}-0`, 'payload', '1');
    await admin.xgroup('CREATE', grouped, 'workers', '0');
    await admin.xadd(fresh, '*', 'payload', '1');
    await admin.xadd(idle, `${old}-0`, 'payload', '1');
    expect(await deleteIdleStream(admin, grouped, idleMs)).toBe('kept');
    expect(await deleteIdleStream(admin, fresh, idleMs)).toBe('kept');
    expect(await deleteIdleStream(admin, idle, idleMs)).toBe('removed');
    expect(await deleteIdleStream(admin, idle, idleMs)).toBe('gone');
    expect(await admin.exists(grouped, fresh, idle)).toBe(2);
    await admin.del(grouped, fresh);
  });

  it('the release script keeps a consumer that owns a pending entry and deletes one that owns nothing', async () => {
    const admin = probe();
    const key = `${newPrefix()}jobs`;
    await admin.xgroup('CREATE', key, 'workers', '0', 'MKSTREAM');
    await admin.xadd(key, '*', 'payload', '1');
    await admin.xreadgroup(
      'GROUP',
      'workers',
      'busy',
      'COUNT',
      1,
      'STREAMS',
      key,
      '>',
    );
    await admin.xreadgroup(
      'GROUP',
      'workers',
      'idle',
      'COUNT',
      1,
      'STREAMS',
      key,
      '>',
    );
    expect(await releaseConsumer(admin, key, 'workers', 'busy')).toBe('kept');
    expect(await releaseConsumer(admin, key, 'workers', 'idle')).toBe(
      'removed',
    );
    expect(await releaseConsumer(admin, key, 'workers', 'idle')).toBe('gone');
    expect(await releaseConsumer(admin, key, 'missing', 'idle')).toBe('gone');
    expect(
      await releaseConsumer(admin, `${key}:missing`, 'workers', 'idle'),
    ).toBe('gone');
    expect(await consumersOf(admin, key, 'workers')).toEqual([
      { name: 'busy', pending: 1 },
    ]);
    await admin.del(key);
  });

  it('acks a throw at maxDeliveries and does not run the handler again', async () => {
    const url = process.env.REDIS_URL ?? '';
    const admin = new Redis(url);
    open.push(admin);
    const prefix = `hexok:queue:it:${randomUUID()}:`;
    const parked: ParkInput[] = [];
    const queue = new RedisQueue({
      redis: url,
      keyPrefix: prefix,
      visibilityMs: 300,
      blockMs: 100,
      stopTimeoutMs: 1000,
      quarantine: {
        async park(input: ParkInput) {
          parked.push(input);
          return { id: 'q1' };
        },
      },
    });
    queues.push(queue);
    await queue.start();
    let calls = 0;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      maxDeliveries: 1,
      handler: async () => {
        calls += 1;
        throw new Error('nope');
      },
    });
    await queue.publish('jobs', { n: 1 });
    const key = `${prefix}jobs`;
    await waitFor(async () => {
      const summary = (await admin.xpending(key, 'workers')) as [number];
      return calls === 1 && summary[0] === 0 && parked.length === 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls).toBe(1);
    expect(parked[0]).toMatchObject({
      attempts: 1,
      error: { message: 'queue: deliveries exhausted' },
    });
    await admin.del(key);
  });
});

/**
 * Redis 6.2 returns a deleted pending entry from `XAUTOCLAIM` as `nil` and keeps it pending. Redis 7 returns its id apart.
 * Run against 6.2 with `docker run --rm -p 6380:6379 redis:6.2-alpine` and `REDIS62_URL=redis://127.0.0.1:6380`.
 */
const recoveryTargets = [
  ['REDIS_URL', process.env.REDIS_URL],
  ['REDIS62_URL', process.env.REDIS62_URL],
] as const;

describe.each(recoveryTargets)('RedisQueue recovery on %s', (_name, url) => {
  it.skipIf(!url)(
    'recovers past a pending entry deleted from the stream and acks it',
    async () => {
      const admin = new Redis(url ?? '');
      const keyPrefix = newPrefix();
      const key = `${keyPrefix}jobs`;
      const queue = new RedisQueue({
        redis: url ?? '',
        keyPrefix,
        visibilityMs: 300,
        blockMs: 100,
      });
      try {
        await admin.xgroup('CREATE', key, 'workers', '0', 'MKSTREAM');
        const deleted = await admin.xadd(key, '*', 'payload', '"gone"');
        const kept = await admin.xadd(key, '*', 'payload', '"kept"');
        // A consumer that died while it held both entries.
        await admin.xreadgroup(
          'GROUP',
          'workers',
          'hexok:dead:1',
          'COUNT',
          10,
          'STREAMS',
          key,
          '>',
        );
        await admin.xdel(key, deleted ?? '');
        await new Promise((resolve) => setTimeout(resolve, 300));
        const handled: string[] = [];
        await queue.start();
        await subscribe(queue, 'jobs', {
          consumerGroup: 'workers',
          handler: async (message) => {
            handled.push(message.id);
          },
        });
        await waitFor(async () => {
          const summary = (await admin.xpending(key, 'workers')) as [number];
          return handled.includes(kept ?? '') && summary[0] === 0;
        });
        expect(handled).toEqual([kept]);
      } finally {
        await queue.stop();
        await admin.del(key);
        await admin.quit();
      }
    },
  );
});

describe.each(recoveryTargets)('RedisQueue scripts on %s', (_name, url) => {
  it.skipIf(!url)(
    'the stream script measures idleness on the Redis clock',
    async () => {
      const admin = new Redis(url ?? '');
      const key = `${newPrefix()}jobs`;
      try {
        const [seconds, micros] = await admin.time();
        const redisNow =
          Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
        await admin.xadd(key, `${redisNow - 5000}-0`, 'payload', '1');
        expect(await deleteIdleStream(admin, key, 10_000)).toBe('kept');
        expect(await deleteIdleStream(admin, key, 1000)).toBe('removed');
        expect(await admin.exists(key)).toBe(0);
      } finally {
        await admin.del(key);
        await admin.quit();
      }
    },
  );
});

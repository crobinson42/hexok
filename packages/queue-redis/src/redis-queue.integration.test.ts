import { randomUUID } from 'node:crypto';
import type { QueueMaxDeliveries, QueueSubscribeOptions } from '@hexok/queue';
import {
  describeRedisLifecycle,
  documentedAclRules,
  RedisProxy,
  runNode,
  withAclUser,
} from '@hexok/test-redis';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ParkInput } from './park.js';
import { RedisQueue } from './redis-queue.js';
import {
  ackDeleted,
  addDelayed,
  delayedMember,
  deleteIdleStream,
  destroyIdleGroup,
  promoteDue,
  releaseConsumer,
  retryLater,
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

/**
 * Writes `count` entries with ids at `timeMs`. `XTRIM MINID ~` removes only whole stream nodes, 100 entries by default, so a single old entry would survive any trim.
 */
async function seed(
  client: Redis,
  key: string,
  count: number,
  timeMs: number,
): Promise<void> {
  const pipe = client.pipeline();
  for (let i = 0; i < count; i += 1) {
    pipe.xadd(key, `${timeMs}-${i}`, 'payload', '{}');
  }
  await pipe.exec();
}

describe.skipIf(!process.env.REDIS_URL)('RedisQueue retention', () => {
  const url = process.env.REDIS_URL ?? '';
  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;
  const open: Redis[] = [];
  const queues: RedisQueue[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    await Promise.all(open.splice(0).map((redis) => redis.quit()));
  });

  function admin(): Redis {
    const client = new Redis(url);
    open.push(client);
    return client;
  }

  async function started(
    config: Omit<ConstructorParameters<typeof RedisQueue>[0], 'redis'>,
  ): Promise<RedisQueue> {
    const queue = new RedisQueue({ redis: url, blockMs: 50, ...config });
    queues.push(queue);
    await queue.start();
    return queue;
  }

  /** Fires the minute's trim timer. It also fires the subscription timers, as a running minute would. */
  async function runTrimTimer(): Promise<void> {
    await vi.advanceTimersByTimeAsync(60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  it('a consumer-only queue never trims an old unread entry', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const keyPrefix = newPrefix();
    const key = `${keyPrefix}jobs`;
    const redis = admin();
    await seed(redis, key, 1000, Date.now() - 2 * DAY_MS);
    const queue = await started({ keyPrefix, retentionMs: 1000 });
    const handled: unknown[] = [];
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      startFrom: 'now',
      handler: async (message) => {
        handled.push(message.id);
      },
    });
    await runTrimTimer();
    await runTrimTimer();
    expect(await redis.xlen(key)).toBe(1000);
    expect(handled).toEqual([]);
    await redis.del(key);
  });

  it('a publisher trims to its own retention on publish', async () => {
    const keyPrefix = newPrefix();
    const key = `${keyPrefix}jobs`;
    const redis = admin();
    const now = Date.now();
    await seed(redis, key, 1000, now - 2 * HOUR_MS);
    await seed(redis, key, 50, now - HOUR_MS / 2);
    const queue = await started({ keyPrefix, retentionMs: HOUR_MS });
    await queue.publish('jobs', { n: 1 });
    // A node of 100 can keep some old entries with the newer ones. The newer entries all stay.
    const left = await redis.xlen(key);
    expect(left).toBeLessThanOrEqual(151);
    expect(left).toBeGreaterThanOrEqual(51);
    await redis.del(key);
  });

  it('a publisher trims again on the timer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const keyPrefix = newPrefix();
    const key = `${keyPrefix}jobs`;
    const redis = admin();
    const queue = await started({ keyPrefix, retentionMs: 500 });
    await queue.publish('jobs', { n: 1 });
    await seed(redis, key, 1000, Date.now() + 1);
    expect(await redis.xlen(key)).toBe(1001);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await runTrimTimer();
    expect(await redis.xlen(key)).toBeLessThan(200);
    await redis.del(key);
  });

  it('trim: false never trims', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const keyPrefix = newPrefix();
    const key = `${keyPrefix}jobs`;
    const redis = admin();
    await seed(redis, key, 1000, Date.now() - 2 * DAY_MS);
    const queue = await started({ keyPrefix, retentionMs: 1000, trim: false });
    await queue.publish('jobs', { n: 1 });
    await runTrimTimer();
    expect(await redis.xlen(key)).toBe(1001);
    await redis.del(key);
  });

  it('maintain trims only with retentionMs, and a dry run does not write', async () => {
    const keyPrefix = newPrefix();
    const key = `${keyPrefix}jobs`;
    const redis = admin();
    const now = Date.now();
    await seed(redis, key, 1000, now - 2 * HOUR_MS);
    await seed(redis, key, 50, now - HOUR_MS / 2);
    // An instance retention must not reach maintain().
    const queue = await started({ keyPrefix, retentionMs: 1000 });

    const none = await queue.maintain({ dryRun: false });
    expect(none.trimmed).toEqual([]);
    expect(await redis.xlen(key)).toBe(1050);

    const dry = await queue.maintain({ retentionMs: HOUR_MS });
    expect(dry.trimmed).toEqual(['jobs']);
    expect(await redis.xlen(key)).toBe(1050);

    const real = await queue.maintain({ dryRun: false, retentionMs: HOUR_MS });
    expect(real.trimmed).toEqual(['jobs']);
    const left = await redis.xlen(key);
    expect(left).toBeLessThanOrEqual(150);
    expect(left).toBeGreaterThanOrEqual(50);
    await redis.del(key);
  });

  it('a kept consumer with a pending entry is reported and stays in the group', async () => {
    const keyPrefix = newPrefix();
    const key = `${keyPrefix}jobs`;
    const redis = admin();
    const warnings: unknown[] = [];
    const queue = await started({
      keyPrefix,
      logger: {
        debug() {},
        info() {},
        warn: (_message, fields) => warnings.push(fields),
        error() {},
      },
    });
    let seen = false;
    await subscribe(queue, 'jobs', {
      consumerGroup: 'workers',
      handler: async () => {
        seen = true;
        return 'retry';
      },
    });
    await queue.publish('jobs', { n: 1 });
    await waitFor(() => seen);
    await waitFor(async () => (await redis.xpending(key, 'workers'))[0] === 1);
    await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
    const [kept] = queue.keptConsumers;
    expect(kept?.reason).toBe('pending');
    expect(warnings).toEqual([
      expect.objectContaining({ reason: 'pending', consumer: kept?.consumer }),
    ]);
    const consumers = await consumersOf(redis, key, 'workers');
    expect(consumers.map((consumer) => consumer.name)).toEqual([
      kept?.consumer,
    ]);
    await redis.del(key);
  });
});

describe.each(recoveryTargets)('RedisQueue ACL on %s', (_name, url) => {
  it.skipIf(!url)(
    'runs every command path as the documented user with no refusal',
    async () => {
      const adminUrl = url ?? '';
      const rules = await documentedAclRules(
        new URL('../README.md', import.meta.url),
      );
      const admin = new Redis(adminUrl);
      const keyPrefix = newPrefix();
      const keys = ['jobs', 'gone', 'idle'].map(
        (topic) => `${keyPrefix}${topic}`,
      );
      try {
        await withAclUser(adminUrl, rules, async (user) => {
          const errors: unknown[] = [];
          const queue = new RedisQueue({
            redis: user.url,
            keyPrefix,
            visibilityMs: 300,
            blockMs: 50,
            stopTimeoutMs: 2000,
            logger: {
              debug() {},
              info() {},
              warn() {},
              error: (error) => errors.push(error),
            },
          });
          onTestFinished(() => queue.stop());
          await queue.start();

          // XADD, XTRIM, XGROUP CREATE, XREADGROUP, XPENDING, XCLAIM, XAUTOCLAIM, XACK.
          await queue.publish('jobs', { n: 1 });
          const deliveries: number[] = [];
          await subscribe(queue, 'jobs', {
            consumerGroup: 'workers',
            handler: async (message) => {
              deliveries.push(message.deliveries);
              if (message.deliveries === 1) return 'retry';
              // Longer than a heartbeat, so XCLAIM runs.
              await new Promise((resolve) => setTimeout(resolve, 250));
              return 'ack';
            },
          });
          await waitFor(() => deliveries.length >= 2);
          await waitFor(
            async () =>
              (await admin.xpending(keys[0] ?? '', 'workers'))[0] === 0,
          );

          // The consumer removal script.
          await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
          expect(await consumersOf(admin, keys[0] ?? '', 'workers')).toEqual(
            [],
          );

          // The script for a pending entry gone from the stream. Redis 7 drops such an entry itself, so the queue reaches this only on 6.2.
          const client = new Redis(user.url);
          const goneKey = keys[1] ?? '';
          await client.xgroup('CREATE', goneKey, 'workers', '0', 'MKSTREAM');
          const goneId = await client.xadd(goneKey, '*', 'payload', '{}');
          await client.xreadgroup(
            'GROUP',
            'workers',
            'hexok:acl',
            'STREAMS',
            goneKey,
            '>',
          );
          await admin.xdel(goneKey, goneId ?? '');
          expect(
            await ackDeleted(client, goneKey, 'workers', 'hexok:acl'),
          ).toEqual([goneId]);
          await client.quit();

          // SCAN, XINFO, XTRIM, and the group and stream scripts. Entries, group, and consumer are all idle.
          const idleKey = keys[2] ?? '';
          const idleId = `${Date.now() - 60_000}-0`;
          await admin.xadd(idleKey, idleId, 'payload', '{}');
          await admin.xgroup('CREATE', idleKey, 'old', '0');
          await admin.xreadgroup(
            'GROUP',
            'old',
            'hexok:old',
            'STREAMS',
            idleKey,
            '>',
          );
          await admin.xack(idleKey, 'old', idleId);
          const report = await queue.maintain({
            dryRun: false,
            retentionMs: 1000,
            idleConsumerMs: 0,
            dropIdleGroups: { idleMs: 1000 },
            dropIdleStreams: { idleMs: 1000 },
          });
          expect(report.consumersRemoved).toContainEqual(
            expect.objectContaining({ topic: 'idle', consumer: 'hexok:old' }),
          );
          expect(report.groupsDestroyed).toContainEqual({
            topic: 'idle',
            group: 'old',
          });
          expect(report.streamsDeleted).toContainEqual({
            topic: 'idle',
            length: 1,
          });

          // QUIT, and the release in stop().
          await subscribe(queue, 'jobs', {
            consumerGroup: 'workers',
            handler: async () => 'ack',
          });
          await queue.stop();

          expect(errors).toEqual([]);
          expect(await user.refusals()).toEqual([]);
        });
      } finally {
        await admin.del(...keys);
        await admin.quit();
      }
    },
  );
});

function newDelayedPrefix(): string {
  return `hexok:queue-delayed:it:${randomUUID()}:`;
}

const sleepMs = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The Redis clock in milliseconds. */
async function redisNow(client: Redis): Promise<number> {
  const [seconds, micros] = await client.time();
  return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
}

describe.each(recoveryTargets)(
  'RedisQueue delay scripts on %s',
  (_name, url) => {
    it.skipIf(!url)(
      'a promote run moves at most 1,000 due entries and never past the back-pressure mark',
      async () => {
        const admin = new Redis(url ?? '');
        const stream = `${newPrefix()}jobs`;
        const delayed = `${newDelayedPrefix()}jobs`;
        try {
          const now = await redisNow(admin);
          const pipe = admin.pipeline();
          for (let i = 0; i < 1500; i += 1) {
            pipe.zadd(
              delayed,
              now - 1000,
              delayedMember(`{"n":${i}}`, false).member,
            );
          }
          pipe.zadd(
            delayed,
            now + 60_000,
            delayedMember('{"later":true}', false).member,
          );
          await pipe.exec();
          const limits = { maxLen: 10_000, mark: 9000, max: 1000 };
          expect(await promoteDue(admin, delayed, stream, limits)).toBe(1000);
          expect(await admin.xlen(stream)).toBe(1000);
          expect(await admin.zcard(delayed)).toBe(501);
          // Room for 5 below the mark moves 5.
          expect(
            await promoteDue(admin, delayed, stream, { ...limits, mark: 1005 }),
          ).toBe(5);
          // At the mark, a run moves nothing.
          expect(
            await promoteDue(admin, delayed, stream, { ...limits, mark: 1005 }),
          ).toBe(-1);
          expect(await admin.xlen(stream)).toBe(1005);
          expect(await promoteDue(admin, delayed, stream, limits)).toBe(495);
          // The entry not yet due stays.
          expect(await promoteDue(admin, delayed, stream, limits)).toBe(0);
          expect(await admin.zcard(delayed)).toBe(1);
        } finally {
          await admin.del(stream, delayed);
          await admin.quit();
        }
      },
    );

    it.skipIf(!url)(
      'the add script scores on the Redis clock, and promote gives a member that names a group a group field',
      async () => {
        const admin = new Redis(url ?? '');
        const stream = `${newPrefix()}jobs`;
        const delayed = `${newDelayedPrefix()}jobs`;
        try {
          const before = await redisNow(admin);
          const plain = delayedMember('{"n":1}', false).member;
          await addDelayed(admin, delayed, { delayMs: 5000, member: plain });
          const score = Number(await admin.zscore(delayed, plain));
          expect(score).toBeGreaterThanOrEqual(before + 5000);
          expect(score).toBeLessThanOrEqual((await redisNow(admin)) + 5000);
          await admin.del(delayed);
          const now = await redisNow(admin);
          await admin.zadd(
            delayed,
            now - 1,
            plain,
            now - 1,
            delayedMember('{"a":"b:c"}', true, 'billing').member,
            now - 1,
            delayedMember('{}', false, 'team:é').member,
          );
          const limits = { maxLen: 10_000, mark: 9000, max: 1000 };
          expect(await promoteDue(admin, delayed, stream, limits)).toBe(3);
          const fields = (await admin.xrange(stream, '-', '+')).map(
            ([, entry]) => entry,
          );
          expect(fields).toHaveLength(3);
          expect(fields).toEqual(
            expect.arrayContaining([
              ['payload', '{"n":1}'],
              ['payload', '{"a":"b:c"}', 'sensitive', '1', 'group', 'billing'],
              ['payload', '{}', 'group', 'team:é'],
            ]),
          );
        } finally {
          await admin.del(stream, delayed);
          await admin.quit();
        }
      },
    );

    it.skipIf(!url)(
      'the retry script acks the entry and adds its replacement in one call, once',
      async () => {
        const admin = new Redis(url ?? '');
        const stream = `${newPrefix()}jobs`;
        const delayed = `${newDelayedPrefix()}jobs`;
        try {
          await admin.xgroup('CREATE', stream, 'workers', '0', 'MKSTREAM');
          const id = (await admin.xadd(stream, '*', 'payload', '{}')) ?? '';
          await admin.xreadgroup(
            'GROUP',
            'workers',
            'c',
            'STREAMS',
            stream,
            '>',
          );
          const { member } = delayedMember('{"attempt":2}', true);
          const before = await redisNow(admin);
          expect(
            await retryLater(
              admin,
              { stream, delayed },
              { group: 'workers', id },
              { delayMs: 5000, member },
            ),
          ).toBe(true);
          expect((await admin.xpending(stream, 'workers'))[0]).toBe(0);
          const scored = await admin.zrange(delayed, '0', '-1', 'WITHSCORES');
          expect(scored[0]).toBe(member);
          expect(Number(scored[1])).toBeGreaterThanOrEqual(before + 5000);
          expect(Number(scored[1])).toBeLessThanOrEqual(
            (await redisNow(admin)) + 5000,
          );
          // The entry is no longer pending, so a second call adds nothing.
          expect(
            await retryLater(
              admin,
              { stream, delayed },
              { group: 'workers', id },
              { delayMs: 5000, member: delayedMember('{}', false).member },
            ),
          ).toBe(false);
          expect(await admin.zcard(delayed)).toBe(1);
        } finally {
          await admin.del(stream, delayed);
          await admin.quit();
        }
      },
    );
  },
);

describe.skipIf(!process.env.REDIS_URL)(
  'RedisQueue delay, retry results, and slots',
  () => {
    const url = process.env.REDIS_URL ?? '';
    const queues: RedisQueue[] = [];
    const open: Redis[] = [];
    const keys: string[] = [];

    afterEach(async () => {
      await Promise.all(queues.splice(0).map((queue) => queue.stop()));
      const admin = new Redis(url);
      if (keys.length > 0) await admin.del(...keys.splice(0));
      await admin.quit();
      await Promise.all(open.splice(0).map((client) => client.quit()));
    });

    function probe(): Redis {
      const client = new Redis(url);
      open.push(client);
      return client;
    }

    function queueOf(
      config: Partial<ConstructorParameters<typeof RedisQueue>[0]> & {
        readonly keyPrefix: string;
        readonly delayedPrefix: string;
      },
    ): RedisQueue {
      const queue = new RedisQueue({ redis: url, blockMs: 100, ...config });
      queues.push(queue);
      keys.push(`${config.keyPrefix}jobs`, `${config.delayedPrefix}jobs`);
      return queue;
    }

    it('does not deliver a delayed entry before its due time, and delivers it within promoteMs plus blockMs after', async () => {
      const queue = queueOf({
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
        promoteMs: 200,
        blockMs: 200,
      });
      await queue.start();
      let receivedAt = 0;
      await subscribe(queue, 'jobs', {
        consumerGroup: 'workers',
        handler: async () => {
          receivedAt = Date.now();
        },
      });
      const dueAt = Date.now() + 800;
      await queue.publish('jobs', { n: 1 }, { delayMs: 800 });
      await waitFor(() => receivedAt > 0);
      // The due time and promotion are on the Redis clock. The container's skew from this clock is a few milliseconds.
      expect(receivedAt).toBeGreaterThanOrEqual(dueAt - 20);
      expect(receivedAt).toBeLessThanOrEqual(dueAt + 200 + 200 + 100);
    });

    it('two instances promoting at once deliver each delayed entry once, identical payloads included', async () => {
      const config = {
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
        promoteMs: 20,
      };
      const first = queueOf(config);
      const second = queueOf(config);
      await Promise.all([first.start(), second.start()]);
      const handled: string[] = [];
      for (const queue of [first, second]) {
        await subscribe(queue, 'jobs', {
          consumerGroup: 'workers',
          handler: async (message) => {
            handled.push(message.id);
          },
        });
      }
      const ids = new Set<string>();
      for (let i = 0; i < 50; i += 1) {
        ids.add(await first.publish('jobs', { same: true }, { delayMs: 300 }));
      }
      expect(ids.size).toBe(50);
      await waitFor(() => handled.length >= 50);
      await sleepMs(300);
      expect(handled).toHaveLength(50);
      expect(new Set(handled).size).toBe(50);
      expect(await probe().xlen(`${config.keyPrefix}jobs`)).toBe(50);
    });

    it('a delayed entry survives a restart of every instance', async () => {
      const config = {
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
        promoteMs: 50,
      };
      const before = queueOf(config);
      await before.start();
      await subscribe(before, 'jobs', {
        consumerGroup: 'workers',
        handler: async () => {},
      });
      await before.publish('jobs', { n: 1 }, { delayMs: 400 });
      await before.stop();
      const after = queueOf(config);
      await after.start();
      const seen: unknown[] = [];
      await subscribe(after, 'jobs', {
        consumerGroup: 'workers',
        handler: async (message) => {
          seen.push(message.payload);
        },
      });
      await waitFor(() => seen.length === 1);
      expect(seen).toEqual([{ n: 1 }]);
    });

    it('a retry result leaves the entry acked and its replacement delayed, then delivers it at delivery 1', async () => {
      const config = {
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
        promoteMs: 50,
      };
      const queue = queueOf(config);
      await queue.start();
      const redis = probe();
      const seen: Array<{ payload: unknown; deliveries: number }> = [];
      let retried = false;
      await queue.subscribe<{ attempt: number }>('jobs', {
        consumerGroup: 'workers',
        maxDeliveries: 1,
        handler: async (message) => {
          seen.push({
            payload: message.payload,
            deliveries: message.deliveries,
          });
          if (message.payload.attempt === 2) return 'ack';
          retried = true;
          return { retryInMs: 500, payload: { attempt: 2 } };
        },
      });
      await queue.publish('jobs', { attempt: 1 });
      await waitFor(() => retried);
      await waitFor(
        async () => (await redis.zcard(`${config.delayedPrefix}jobs`)) === 1,
      );
      expect(
        (await redis.xpending(`${config.keyPrefix}jobs`, 'workers'))[0],
      ).toBe(0);
      await waitFor(() => seen.length === 2);
      expect(seen).toEqual([
        { payload: { attempt: 1 }, deliveries: 1 },
        { payload: { attempt: 2 }, deliveries: 1 },
      ]);
      expect(await redis.zcard(`${config.delayedPrefix}jobs`)).toBe(0);
    });

    it('a delayed publish is due on the Redis clock when the publisher clock is behind', async () => {
      const config = {
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
      };
      const queue = queueOf(config);
      await queue.start();
      const redis = probe();
      const before = await redisNow(redis);
      const behind = Date.now() - 60_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(behind);
      try {
        await queue.publish('jobs', { n: 1 }, { delayMs: 800 });
      } finally {
        clock.mockRestore();
      }
      const [, score] = await redis.zrange(
        `${config.delayedPrefix}jobs`,
        '0',
        '-1',
        'WITHSCORES',
      );
      expect(Number(score)).toBeGreaterThanOrEqual(before + 800);
      expect(Number(score)).toBeLessThanOrEqual((await redisNow(redis)) + 800);
    });

    it('a retry goes back only to the group that returned it', async () => {
      const config = {
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
        promoteMs: 50,
      };
      const queue = queueOf(config);
      await queue.start();
      const billing: unknown[] = [];
      const email: unknown[] = [];
      await queue.subscribe<{ attempt: number }>('jobs', {
        consumerGroup: 'billing',
        maxDeliveries: 'unlimited',
        handler: async (message) => {
          billing.push(message.payload);
          if (message.payload.attempt === 1) {
            return { retryInMs: 200, payload: { attempt: 2 } };
          }
          return 'ack';
        },
      });
      await queue.subscribe<{ attempt: number }>('jobs', {
        consumerGroup: 'email',
        maxDeliveries: 'unlimited',
        handler: async (message) => {
          email.push(message.payload);
        },
      });
      await queue.publish('jobs', { attempt: 1 });
      await waitFor(() => billing.length === 2);
      // The replacement is in the stream, so email has read it by the time it reads past it.
      await queue.publish('jobs', { attempt: 3 });
      await waitFor(() => email.length === 2 && billing.length === 3);
      expect(billing).toEqual([{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }]);
      expect(email).toEqual([{ attempt: 1 }, { attempt: 3 }]);
      const redis = probe();
      for (const group of ['billing', 'email']) {
        expect(
          (await redis.xpending(`${config.keyPrefix}jobs`, group))[0],
        ).toBe(0);
      }
    });

    it('stop() and unsubscribe() from a handler wait for its sibling handlers and ack them', async () => {
      for (const end of ['stop', 'unsubscribe'] as const) {
        const config = {
          keyPrefix: newPrefix(),
          delayedPrefix: newDelayedPrefix(),
          stopTimeoutMs: 5000,
        };
        const queue = queueOf(config);
        await queue.start();
        for (let i = 0; i < 3; i += 1) await queue.publish('jobs', { i });
        let started = 0;
        const finished: number[] = [];
        let endedAt = 0;
        let callerId = '';
        await queue.subscribe<{ i: number }>('jobs', {
          consumerGroup: 'workers',
          maxDeliveries: 'unlimited',
          concurrency: 3,
          handler: async (message) => {
            started += 1;
            if (message.payload.i !== 0) {
              await sleepMs(400);
              finished.push(Date.now());
              return;
            }
            callerId = message.id;
            await waitFor(() => started === 3);
            if (end === 'stop') await queue.stop();
            else await queue.unsubscribe('jobs', { consumerGroup: 'workers' });
            endedAt = Date.now();
          },
        });
        await waitFor(() => endedAt > 0);
        expect(finished).toHaveLength(2);
        for (const at of finished) expect(endedAt).toBeGreaterThanOrEqual(at);
        // Only the caller's own entry stays pending.
        const pending = await probe().xpending(
          `${config.keyPrefix}jobs`,
          'workers',
          '-',
          '+',
          10,
        );
        expect(
          pending.map((row) => (Array.isArray(row) ? row[0] : undefined)),
        ).toEqual([callerId]);
      }
    });

    it('acks a plain JavaScript handler that returns null', async () => {
      const keyPrefix = newPrefix();
      const delayedPrefix = newDelayedPrefix();
      keys.push(`${keyPrefix}jobs`, `${delayedPrefix}jobs`);
      const result = await runQueue(
        `
const queue = new RedisQueue({
  redis: process.env.REDIS_URL,
  keyPrefix: process.env.KEY_PREFIX,
  delayedPrefix: process.env.DELAYED_PREFIX,
  blockMs: 50,
});
await queue.start();
let calls = 0;
await queue.subscribe('jobs', {
  consumerGroup: 'workers',
  maxDeliveries: 'unlimited',
  handler: async () => {
    calls += 1;
    return null;
  },
});
await queue.publish('jobs', {});
while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 20));
await queue.stop();
console.log(calls);
`,
        { KEY_PREFIX: keyPrefix, DELAYED_PREFIX: delayedPrefix },
      );
      expect(result.stderr).toBe('');
      expect(result.stdout.trim()).toBe('1');
      expect((await probe().xpending(`${keyPrefix}jobs`, 'workers'))[0]).toBe(
        0,
      );
    });

    it('with concurrency 5 runs five slow handlers at once, reclaims none, and stop waits for all of them', async () => {
      const config = {
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
        visibilityMs: 300,
        stopTimeoutMs: 5000,
      };
      const queue = queueOf(config);
      await queue.start();
      for (let i = 0; i < 10; i += 1) await queue.publish('jobs', { i });
      let running = 0;
      let most = 0;
      let finished = 0;
      const started: string[] = [];
      await queue.subscribe('jobs', {
        consumerGroup: 'workers',
        maxDeliveries: 'unlimited',
        concurrency: 5,
        handler: async (message) => {
          started.push(message.id);
          running += 1;
          most = Math.max(most, running);
          // Three times visibilityMs, so a reclaim would show as a second start.
          await sleepMs(900);
          running -= 1;
          finished += 1;
        },
      });
      await waitFor(() => started.length === 5);
      await sleepMs(300);
      expect(running).toBe(5);
      await queue.stop();
      expect(finished).toBe(5);
      expect(most).toBe(5);
      expect(new Set(started).size).toBe(started.length);
      expect(started).toHaveLength(5);
      const redis = probe();
      expect(
        (await redis.xpending(`${config.keyPrefix}jobs`, 'workers'))[0],
      ).toBe(0);
    });

    it('redelivers 1,000 entries a killed consumer left pending within a few recovery runs', async () => {
      const config = {
        keyPrefix: newPrefix(),
        delayedPrefix: newDelayedPrefix(),
        visibilityMs: 2000,
      };
      const key = `${config.keyPrefix}jobs`;
      const redis = probe();
      await redis.xgroup('CREATE', key, 'workers', '0', 'MKSTREAM');
      const pipe = redis.pipeline();
      for (let i = 0; i < 1000; i += 1)
        pipe.xadd(key, '*', 'payload', `{"i":${i}}`);
      await pipe.exec();
      await redis.xreadgroup(
        'GROUP',
        'workers',
        'hexok:killed',
        'COUNT',
        1000,
        'STREAMS',
        key,
        '>',
      );
      // Every entry is idle past visibilityMs when the first recovery run comes.
      await sleepMs(1100);
      const queue = queueOf(config);
      await queue.start();
      const handled = new Set<string>();
      const subscribedAt = Date.now();
      await subscribe(queue, 'jobs', {
        consumerGroup: 'workers',
        handler: async (message) => {
          handled.add(message.id);
        },
      });
      await waitFor(() => handled.size === 1000);
      // Recovery runs every 1000ms. At 10 entries a run, 1,000 would take 100 runs.
      expect(Date.now() - subscribedAt).toBeLessThan(3500);
      await waitFor(
        async () => (await redis.xpending(key, 'workers'))[0] === 0,
      );
    });

    it('maintain does not report the delayed set, even under a keyPrefix that covers it', async () => {
      const base = `hexok:queue:it:${randomUUID()}:`;
      for (const config of [
        { keyPrefix: newPrefix(), delayedPrefix: newDelayedPrefix() },
        { keyPrefix: base, delayedPrefix: `${base}delayed:` },
      ]) {
        const queue = queueOf(config);
        await queue.start();
        await queue.publish('jobs', { n: 1 });
        await queue.publish('jobs', { n: 2 }, { delayMs: 60_000 });
        expect(await probe().zcard(`${config.delayedPrefix}jobs`)).toBe(1);
        const report = await queue.maintain();
        expect(report.scanned).toBe(1);
        expect(report.skipped).toEqual([]);
      }
    });
  },
);

describe.each(recoveryTargets)('RedisQueue delay ACL on %s', (_name, url) => {
  it.skipIf(!url)(
    'runs delayed publish, promote, and the retry script as the documented user with no refusal',
    async () => {
      const adminUrl = url ?? '';
      const rules = await documentedAclRules(
        new URL('../README.md', import.meta.url),
      );
      const admin = new Redis(adminUrl);
      const keyPrefix = newPrefix();
      const delayedPrefix = newDelayedPrefix();
      try {
        await withAclUser(adminUrl, rules, async (user) => {
          const errors: unknown[] = [];
          const queue = new RedisQueue({
            redis: user.url,
            keyPrefix,
            delayedPrefix,
            promoteMs: 50,
            blockMs: 50,
            stopTimeoutMs: 2000,
            logger: {
              debug() {},
              info() {},
              warn() {},
              error: (error) => errors.push(error),
            },
          });
          onTestFinished(() => queue.stop());
          await queue.start();
          const seen: number[] = [];
          await queue.subscribe<{ attempt: number }>('jobs', {
            consumerGroup: 'workers',
            maxDeliveries: 'unlimited',
            concurrency: 2,
            handler: async (message) => {
              seen.push(message.payload.attempt);
              if (message.payload.attempt > 1) return 'ack';
              return { retryInMs: 50, payload: { attempt: 2 } };
            },
          });
          // ZADD, then the promote script, then the retry script, then the promote script again.
          await queue.publish('jobs', { attempt: 1 }, { delayMs: 50 });
          await waitFor(() => seen.length === 2);
          await queue.stop();
          expect(seen).toEqual([1, 2]);
          expect(errors).toEqual([]);
          expect(await user.refusals()).toEqual([]);
        });
      } finally {
        await admin.del(`${keyPrefix}jobs`, `${delayedPrefix}jobs`);
        await admin.quit();
      }
    },
  );
});

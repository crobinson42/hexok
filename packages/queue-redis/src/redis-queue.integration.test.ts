import { spawn } from 'node:child_process';
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

/** Runs `src` in a child Node. Node strips the types. The hook maps `./x.js` to `./x.ts`. */
const childPrelude = `
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw error;
      return next(specifier.slice(0, -3) + '.ts', context);
    }
  },
});
const { RedisQueue } = await import(process.env.QUEUE_ENTRY);
`;

async function runChild(
  body: string,
  env: Record<string, string>,
): Promise<{
  code: number | null;
  ms: number;
  exitedAt: number;
  stdout: string;
  stderr: string;
}> {
  const started = Date.now();
  const child = spawn(
    process.execPath,
    ['--no-warnings', '--input-type=module', '-e', childPrelude + body],
    {
      env: {
        ...process.env,
        QUEUE_ENTRY: new URL('./redis-queue.ts', import.meta.url).href,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 6000,
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', resolve);
  });
  const exitedAt = Date.now();
  return { code, ms: exitedAt - started, exitedAt, stdout, stderr };
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

  it('lets the process exit after stop with the default visibility', async () => {
    const result = await runChild(
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
    await queue.subscribe('codes', {
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
    const result = await runChild(
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
    const result = await runChild(
      `
import net from 'node:net';
const target = new URL(process.env.REDIS_URL);
const sockets = new Set();
const proxy = net.createServer((client) => {
  const upstream = net.connect(Number(target.port || 6379), target.hostname);
  for (const socket of [client, upstream]) {
    sockets.add(socket);
    socket.on('error', () => {});
  }
  client.pipe(upstream).pipe(client);
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const queue = new RedisQueue({
  redis: { host: '127.0.0.1', port: proxy.address().port, disconnectTimeout: 100 },
  keyPrefix: process.env.KEY_PREFIX,
  blockMs: 200,
});
await queue.start();
await queue.subscribe('jobs', { consumerGroup: 'workers', handler: async () => 'ack' });
await new Promise((resolve) => setTimeout(resolve, 100));
proxy.close();
for (const socket of sockets) socket.destroy();
await new Promise((resolve) => setTimeout(resolve, 300));
const stopping = Date.now();
await queue.stop();
console.log(JSON.stringify({ stopMs: Date.now() - stopping, stoppedAt: Date.now() }));
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
    await queue.subscribe('jobs', {
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

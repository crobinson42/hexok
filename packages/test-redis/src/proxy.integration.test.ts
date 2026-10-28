import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisProxy } from './proxy.js';
import { runNode } from './run-node.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

function connectError(port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(undefined);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code));
  });
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function settled(promise: Promise<unknown>): () => boolean {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  return () => done;
}

describe.skipIf(!process.env.REDIS_URL)('RedisProxy', () => {
  let proxy: RedisProxy;
  const clients: Redis[] = [];

  function client(): Redis {
    const made = new Redis({
      host: proxy.host,
      port: proxy.port,
      maxRetriesPerRequest: null,
      retryStrategy: () => 20,
    });
    made.on('error', () => {});
    clients.push(made);
    return made;
  }

  beforeEach(async () => {
    proxy = await RedisProxy.start();
  });

  afterEach(async () => {
    for (const made of clients.splice(0)) made.disconnect();
    await proxy.close();
  });

  it('passes commands through', async () => {
    const made = client();
    expect(await made.ping()).toBe('PONG');
    expect(proxy.mode).toBe('pass');
    expect(proxy.connections).toBe(1);
    expect(proxy.url).toBe(`redis://127.0.0.1:${proxy.port}`);
  });

  it('refuse rejects new connections and keeps open ones working', async () => {
    const made = client();
    await made.ping();
    await proxy.refuse();
    expect(await connectError(proxy.port)).toBe('ECONNREFUSED');
    expect(await made.ping()).toBe('PONG');
  });

  it('restore accepts connections again on the same port', async () => {
    await proxy.refuse();
    const port = proxy.port;
    await proxy.restore();
    expect(proxy.port).toBe(port);
    expect(await connectError(port)).toBeUndefined();
  });

  it('drop closes open connections and the client reconnects', async () => {
    const made = client();
    await made.ping();
    proxy.drop();
    await until(() => made.status !== 'ready');
    expect(await made.ping()).toBe('PONG');
  });

  it('refuse and drop together hold commands until restore', async () => {
    const made = client();
    await made.ping();
    await proxy.refuse();
    proxy.drop();
    const done = settled(made.ping());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(done()).toBe(false);
    await proxy.restore();
    await until(done);
  });

  it('blackhole answers nothing and restore delivers held commands in order', async () => {
    const made = client();
    const key = `hexok:test-redis:${randomUUID()}`;
    await made.ping();
    proxy.blackhole();
    const writes = [1, 2, 3].map((n) => made.rpush(key, String(n)));
    const done = settled(Promise.all(writes));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(done()).toBe(false);
    expect(made.status).toBe('ready');
    await proxy.restore();
    expect(await Promise.all(writes)).toEqual([1, 2, 3]);
    expect(await made.lrange(key, 0, -1)).toEqual(['1', '2', '3']);
    await made.del(key);
  });

  it('blackhole accepts a new connection and never answers it', async () => {
    proxy.blackhole();
    const made = client();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(made.status).not.toBe('ready');
    expect(proxy.connections).toBe(1);
    await proxy.restore();
    await until(() => made.status === 'ready');
  });

  it('sockets counts the proxy sockets on both sides', async () => {
    const made = client();
    await made.ping();
    expect(proxy.sockets).toBe(2);
    made.disconnect();
    await until(() => proxy.sockets === 0);
    expect(proxy.connections).toBe(0);
  });

  it('close leaves no handles, even with clients connected or blackholed', async () => {
    const result = await runNode(
      `
import { Redis } from 'ioredis';
import { RedisProxy } from ${JSON.stringify(new URL('./proxy.ts', import.meta.url).href)};
const proxy = await RedisProxy.start(process.env.REDIS_URL);
const client = new Redis({ host: proxy.host, port: proxy.port, lazyConnect: true });
client.on('error', () => {});
await client.connect();
await client.ping();
proxy.blackhole();
await proxy.close();
client.disconnect();
console.log(Date.now());
`,
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.exitedAt - Number(result.stdout)).toBeLessThan(500);
  });
});

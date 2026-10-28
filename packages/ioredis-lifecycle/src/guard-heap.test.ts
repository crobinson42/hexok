import { runNode } from '@hexok/test-redis';
import { expect, it } from 'vitest';

const entry = new URL('./redis-lifecycle.ts', import.meta.url).href;

it('the guard retains nothing after many calls', async () => {
  const result = await runNode(
    `
import { EventEmitter } from 'node:events';
import { RedisLifecycle } from ${JSON.stringify(entry)};

const client = Object.assign(new EventEmitter(), {
  status: 'ready',
  quit: async () => 'OK',
  disconnect() {},
});
const lifecycle = new RedisLifecycle({ adapter: 'heap', stopTimeoutMs: 1000 });
await lifecycle.start(() => ({ main: client }));
const abort = new AbortController();
const calls = 20_000;
const size = 1024;
const call = (i) =>
  lifecycle.run('get', async () => 'x'.repeat(size) + i, { signal: abort.signal });
const fail = (i) =>
  lifecycle
    .run('get', async () => { throw new Error('x'.repeat(size) + i); }, { signal: abort.signal })
    .catch(() => undefined);
for (let i = 0; i < 200; i += 1) await call(i);
const before = heapUsed();
for (let i = 0; i < calls; i += 1) {
  await call(i);
  await fail(i);
}
const growth = heapUsed() - before;
await lifecycle.stop();
console.log(JSON.stringify({ growth, retainedIfLeaked: calls * 2 * size }));
`,
    { exposeGc: true },
  );
  expect(result.stderr).toBe('');
  expect(result.code).toBe(0);
  const { growth, retainedIfLeaked } = JSON.parse(result.stdout) as {
    growth: number;
    retainedIfLeaked: number;
  };
  expect(retainedIfLeaked).toBeGreaterThan(40_000_000);
  expect(growth).toBeLessThan(2_000_000);
});

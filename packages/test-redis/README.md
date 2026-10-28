# @hexok/test-redis

Test utilities for the Redis adapters in this repository. It is private and is used only as a devDependency.

## RedisProxy

A TCP proxy in front of Redis that fakes outages. `RedisProxy.start()` listens on a free port and forwards to `REDIS_URL`.

- `refuse()` closes the listener. New connections get `ECONNREFUSED`. Open connections keep working.
- `blackhole()` accepts connections and answers nothing, on open and new connections alike.
- `drop()` destroys every open connection.
- `restore()` goes back to pass-through on the same port. Bytes held while blackholed are sent in order.
- `close()` destroys every connection and closes the listener. It leaves no handles.

`refuse()` with `drop()` is "Redis is down". `blackhole()` is a network partition. `connections` counts accepted client sockets, and `sockets` counts the proxy's own sockets on both sides.

## runNode

`runNode(source, { env, exposeGc, timeoutMs })` runs an ES module in a child Node and resolves with `code`, `signal`, `ms`, `exitedAt`, `stdout`, `stderr`, and `heap`. The source can import `.ts` files by URL. Node strips the types, and a relative `./x.js` import resolves to `./x.ts`. A global `heapUsed()` returns `process.memoryUsage().heapUsed`, after two GCs with `exposeGc`. The child runs until its event loop is empty, so `ms` shows a handle left open.

## describeRedisLifecycle

`describeRedisLifecycle(name, factory, options?)` asserts the `@hexok/ioredis-lifecycle` guarantees against real Redis behind a `RedisProxy`. Call it at the top level of an `*.integration.test.ts` file. It skips when `REDIS_URL` is unset and throws when `CI` is set without it.

```ts
import { describeRedisLifecycle } from '@hexok/test-redis';
import { RedisQueue } from './redis-queue.js';

describeRedisLifecycle('RedisQueue', ({ redis, stopTimeoutMs }) => {
  const queue = new RedisQueue({ redis, stopTimeoutMs });
  return {
    start: () => queue.start(),
    stop: () => queue.stop(),
    operate: () => queue.publish('jobs', { n: 1 }),
  };
});
```

The factory gets `redis` options that point at the proxy, and a `stopTimeoutMs`. It returns `start`, `stop`, and one guarded `operate`. The suite checks errors by `code`, so `operate` must let the lifecycle error reach the caller with its `code`. It asserts:

- `start` waits until Redis is ready.
- `operate` rejects with `NotStarted` before start, `Starting` during start, and `Stopped` after stop.
- `start` rejects with `Stopped` when `stop` is called while Redis is down, or at once.
- An operation queued during an outage or blackhole rejects with `StoppedBeforeReply` on stop.
- `stop` resolves within `stopTimeoutMs` while Redis refuses connections, is blackholed, or has just dropped them.
- No socket or timer the adapter made outlives `stop`.
- `start` works again after `stop`.

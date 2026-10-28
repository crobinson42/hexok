# @hexok/queue-redis

## 0.2.0

### Minor Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`f5a86de`](https://github.com/crobinson42/hexok/commit/f5a86de8b3429f27d192e933417416394b679bbe) Thanks [@crobinson42](https://github.com/crobinson42)! - `RedisQueue.start()` waits for the commands client to be ready, and `stop()` clears every timer and is bounded even when Redis is unreachable, so the process can exit. `publish` takes `{ sensitive }` and keeps a sensitive payload out of quarantine, logs, and the thrown error. Connection errors from every client go to the logger.

- [#9](https://github.com/crobinson42/hexok/pull/9) [`32fbd4c`](https://github.com/crobinson42/hexok/commit/32fbd4c5f191199e0bf890bd8093736b8aded812) Thanks [@crobinson42](https://github.com/crobinson42)! - `RedisQueue` runs on `@hexok/ioredis-lifecycle`. It has the same lifecycle, error codes, and log fields as the other Redis adapters.

  - `stop()` finishes within `stopTimeoutMs`, which defaults to 10000. A handler still running is no longer waited for. It keeps running until the process exits, and its entry is not acked, so another consumer delivers it again after `visibilityMs`.
  - `startTimeoutMs` makes `start()` reject with `StartTimeout` when Redis is not ready in time. It is unset by default, so `start()` waits.
  - A command queued during an outage rejects with `StoppedBeforeReply` on `stop()`. Before, it never settled.
  - A handler that finishes while `stop()` or `unsubscribe()` waits is acked, so a deploy no longer redelivers every message in flight.
  - Every entry of a read batch is in the heartbeat until it settles. Before, entries waiting behind a slow handler were reclaimed and handled twice, by the same subscription too.
  - On Redis 6.2, recovery no longer stops for good at a pending entry deleted from the stream. That entry is acked.
  - `maintain()` measures stream idleness on the Redis clock, not on this process's clock.
  - A consumer that owns pending entries is kept on `unsubscribe()` and `stop()`. Before, it was deleted, and its entries were lost. `maintain()` checks a consumer, group, or stream again in one Lua script before it removes it.
  - A `publish()` cut short by `stop()` is parked with `outcome: 'unknown'` in its context, since Redis may have stored it.
  - `LifecycleError` and the `LifecycleState` type are exported from this package. `LogSink` is the lifecycle's type.
  - `state` returns the lifecycle state, such as `ready`, to gate traffic during startup and shutdown.

  Upgrade notes:

  - Errors are a `LifecycleError` with a `code`. Branch on `code`, not on the message. The old message `queue: start() was not called` is gone.
  - `publish()`, `subscribe()`, and `maintain()` while `start()` is pending reject with `Starting`. Before, `start()` resolved at once. Await `start()` first.
  - `stop()` waited up to `visibilityMs` for handlers, then sent an unbounded `QUIT`. It now takes at most `stopTimeoutMs` in all, 10 seconds by default.
  - `unsubscribe()` now waits up to `stopTimeoutMs` for its subscription's handlers. Before, it returned without waiting. A handler that calls `unsubscribe()` on its own subscription, or `stop()`, is not waited for.
  - Log fields are `{ adapter: 'queue', connection, topic, group }`, with `id` for an entry and `code` for a lifecycle error. A handler or decode failure has no `connection`. Before, they were `{ topic }`, `{ topic, group }`, or `{ topic, id }`. A background command that `stop()` cut short is logged at `warn`. `unsubscribe()` logs at `warn` when it stops waiting for handlers and leaves the consumer for `maintain()`.

### Patch Changes

- Updated dependencies [[`45b26c8`](https://github.com/crobinson42/hexok/commit/45b26c83eb06e4b1320f294e6f8fc430d432c992), [`e1f8069`](https://github.com/crobinson42/hexok/commit/e1f806987c22120e74d66c8f1d38e7a7dbffaa6e), [`a2ef655`](https://github.com/crobinson42/hexok/commit/a2ef655e3219fc91ae783f8f662107359e1bc253), [`ef5febe`](https://github.com/crobinson42/hexok/commit/ef5febef9cdb084c346ac4f34953f72cd030592d)]:
  - hexok@2.2.1
  - @hexok/ioredis-lifecycle@0.1.0
  - @hexok/queue@0.2.0

## 0.1.0

### Minor Changes

- [#5](https://github.com/crobinson42/hexok/pull/5) [`dbf1516`](https://github.com/crobinson42/hexok/commit/dbf1516e1551af5d593070eb40757238b20b85d9) Thanks [@crobinson42](https://github.com/crobinson42)! - Add a quarantine port for a failed outbound attempt, and optional park hooks on the email, SMS, and Redis queue adapters.

- [#5](https://github.com/crobinson42/hexok/pull/5) [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8) Thanks [@crobinson42](https://github.com/crobinson42)! - Initial 0.1.0 release of @hexok/queue-redis.

### Patch Changes

- Updated dependencies [[`11e10cd`](https://github.com/crobinson42/hexok/commit/11e10cd90b636215324f3f54c03acdd91a3da159), [`faf7f47`](https://github.com/crobinson42/hexok/commit/faf7f472b56ad6e2b1b17dac86908e20ee6540a6), [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8)]:
  - hexok@2.2.0
  - @hexok/queue@0.1.0

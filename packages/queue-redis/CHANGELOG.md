# @hexok/queue-redis

## 1.1.0

### Minor Changes

- [#12](https://github.com/crobinson42/hexok/pull/12) [`2de33a6`](https://github.com/crobinson42/hexok/commit/2de33a62278314cc4ff9edb60b5042ba0e858335) Thanks [@crobinson42](https://github.com/crobinson42)! - Consumers no longer trim. A queue that only subscribes to a topic never trims that stream, so a consumer no longer deletes entries, read or not, under its own `retentionMs`. A publisher still trims the topics it published to, after each publish and every minute. A stream with no running publisher is not age-trimmed. `RedisQueueConfig` takes `trim`, either `'published'`, the default, or `false`, which never age-trims. `MAXLEN ~` on `XADD` applies either way.

- [#12](https://github.com/crobinson42/hexok/pull/12) [`09fce0b`](https://github.com/crobinson42/hexok/commit/09fce0b01aa6da0eb72a7c37006d9ddeb666f8fb) Thanks [@crobinson42](https://github.com/crobinson42)! - `stop()` and `unsubscribe()` log a `warn` for each consumer they keep, with `topic`, `group`, `consumer`, and `reason`. The reason is `inflight`, `not_ready`, `pending`, or `timeout`. `RedisQueue.keptConsumers` lists the consumers kept since the last `start()`. A consumer kept with a pending entry, and one left when `stop()` timed out, were silent before. The existing `unsubscribe()` timeout warning gains `consumer` and `reason`.

- [#12](https://github.com/crobinson42/hexok/pull/12) [`1b090a6`](https://github.com/crobinson42/hexok/commit/1b090a6e9134a85f9c54dfbdce2d490f688ee2a0) Thanks [@crobinson42](https://github.com/crobinson42)! - `maintain()` takes `retentionMs` and trims only when it is given. It no longer uses the instance's `retentionMs`, which let one process shorten streams other services publish with longer retention. A `maintain()` that relied on the old trim must now pass `retentionMs`. Without it, `report.trimmed` is empty.

### Patch Changes

- [#12](https://github.com/crobinson42/hexok/pull/12) [`b8b63ba`](https://github.com/crobinson42/hexok/commit/b8b63ba5c47212e8602d474a85b399cdb18ed808) Thanks [@crobinson42](https://github.com/crobinson42)! - An age trim runs under the lifecycle operation `trim`, not `publish`.

- [#12](https://github.com/crobinson42/hexok/pull/12) [`708ed04`](https://github.com/crobinson42/hexok/commit/708ed046a9749a0f5fae8ba50e919426add5850f) Thanks [@crobinson42](https://github.com/crobinson42)! - The README documents a least-privilege Redis ACL line, listing every command the adapter sends, the commands inside its Lua scripts, and the `INFO` and `CLIENT SETINFO` that ioredis sends.

## 1.0.0

### Major Changes

- [`9e42ece`](https://github.com/crobinson42/hexok/commit/9e42eced138949d2f17d3a49c0fa5cc51f2b19c5) Thanks [@crobinson42](https://github.com/crobinson42)! - Require `ioredis` 6. Connections negotiate RESP3 and keep v5 reply shapes. `@hexok/ioredis-lifecycle` no longer accepts `ioredis` 5.

- [`091523f`](https://github.com/crobinson42/hexok/commit/091523f4119b6ebff19cd1d72ee61cd26c0ed985) Thanks [@crobinson42](https://github.com/crobinson42)! - `subscribe` requires `maxDeliveries`. A positive integer runs the handler at most that many times. `'unlimited'` keeps retrying. A retry at the ceiling is acknowledged. The Redis adapter reads the pending delivery count and parks a give-up when a sink is set. A give-up is `source: 'queue'`, `operation: 'deliver'`, subject `topic:id`, and error `queue: deliveries exhausted`. Quarantine has no replay method. A republish is a new entry.

### Patch Changes

- Updated dependencies [[`9e42ece`](https://github.com/crobinson42/hexok/commit/9e42eced138949d2f17d3a49c0fa5cc51f2b19c5), [`091523f`](https://github.com/crobinson42/hexok/commit/091523f4119b6ebff19cd1d72ee61cd26c0ed985)]:
  - @hexok/ioredis-lifecycle@1.0.0
  - @hexok/queue@1.0.0
  - hexok@2.2.2

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

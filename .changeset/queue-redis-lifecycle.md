---
"@hexok/queue-redis": minor
---

`RedisQueue` runs on `@hexok/ioredis-lifecycle`. It has the same lifecycle, error codes, and log fields as the other Redis adapters.

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

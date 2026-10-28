---
"@hexok/queue-redis": minor
---

`RedisQueue` runs on `@hexok/ioredis-lifecycle`, the lifecycle every hexok Redis adapter shares. A command queued during an outage now rejects with `StoppedBeforeReply` on `stop()` instead of never settling. `unsubscribe()` finishes within `stopTimeoutMs` when Redis stops answering. `unsubscribe()`, `stop()`, and `maintain()` remove a consumer with one atomic script, so a consumer that just took an entry is kept.

Upgrade notes:

- Lifecycle errors are a `LifecycleError` with a `code`: `NotStarted`, `Starting`, `Stopped`, `StoppedBeforeReply`, `StartTimeout`, or `EndedBeforeReady`. Import `LifecycleError` and the `LifecycleState` type from `@hexok/queue-redis`, and branch on `code`. The messages changed. A call while `start()` is pending says `start() has not finished` instead of `start() was not called`.
- `stopTimeoutMs` bounds `stop()` and `unsubscribe()`. It defaults to `visibilityMs`, which `stop()` used before.
- `startTimeoutMs` makes `start()` reject when Redis is not ready in time. It is unset by default, so `start()` waits as before.
- `queue.state` returns the lifecycle state for a readiness or health check.
- `unsubscribe()` now waits up to `stopTimeoutMs` for the subscription's in-flight handlers, as `stop()` does.
- Log fields are `{ adapter: 'queue', connection, topic, group }`. `LogSink` is the lifecycle's type.

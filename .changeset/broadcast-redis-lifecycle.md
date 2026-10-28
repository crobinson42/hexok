---
"@hexok/broadcast-redis": minor
---

`RedisBroadcast` runs on `@hexok/ioredis-lifecycle`. It has the same lifecycle, error codes, and log fields as the other Redis adapters.

- `stopTimeoutMs` bounds all of `stop()`. It defaults to 1000, the old fixed `QUIT` bound.
- `startTimeoutMs` makes `start()` reject with `StartTimeout` when Redis is not ready in time. It is unset by default, so `start()` waits.
- A `publish`, `subscribe`, or `unsubscribe` queued during an outage rejects with `StoppedBeforeReply` on `stop()`. Before, it never settled.
- `LifecycleError` and the `LifecycleState` type are exported from this package.
- `state` returns the lifecycle state, such as `ready`, for a readiness or health check.

Upgrade notes:

- Errors are a `LifecycleError` with a `code`. Branch on `code`, not on the message. The old messages, such as `start() was not called` and `stop() was called before ready`, are gone.
- `publish` and `subscribe` while `start()` is pending now reject with `Starting`. Before, they waited for Redis. Await `start()` first.
- `publish` and `subscribe` before `start()` reject with `NotStarted`, and after `stop()` with `Stopped`.
- Log fields are `{ adapter: 'broadcast', connection }`, and `channel` for a decode or handler failure. Before, they were `{ connection }` or `{ channel }`.

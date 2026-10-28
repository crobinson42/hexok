---
"@hexok/broadcast-redis": minor
---

`RedisBroadcast` runs on `@hexok/ioredis-lifecycle`, the lifecycle every hexok Redis adapter shares. `stop()` resolves within `stopTimeoutMs`, even when Redis is unreachable. A `publish()` or `subscribe()` still pending when `stop()` stops waiting rejects with `StoppedBeforeReply`.

- `stopTimeoutMs` bounds all of `stop()`. It defaults to 1000.
- `startTimeoutMs` makes `start()` reject with `StartTimeout` when Redis is not ready in time. It is unset by default, so `start()` waits for Redis.
- `state` is `ready` from `start()` until `stop()`. Use it to gate traffic during startup and shutdown, not as a Redis health check.
- `LifecycleError` and the `LifecycleState` type are exported. `LogSink` is the lifecycle's type.

Upgrade notes from 0.1.0:

- Lifecycle errors are a `LifecycleError` with a `code`: `NotStarted`, `Starting`, `Stopped`, `StoppedBeforeReply`, `StartTimeout`, or `EndedBeforeReady`. Branch on `code`. A call before `start()` no longer throws `broadcast: start() was not called`.
- A `publish()` or `subscribe()` before `start()` resolves now rejects with `Starting` instead of waiting for Redis. Await `start()` first.
- A `publish()` or `subscribe()` after `stop()` rejects with `Stopped`.
- `stop()` no longer sends `UNSUBSCRIBE`. `QUIT` ends the subscriptions.
- `unsubscribe()` never rejects with a lifecycle error.
- Every log entry carries `adapter: 'broadcast'`. A connection error also carries `connection`, `publisher` or `subscriber`. A decode or handler failure carries `channel` and no `connection`.

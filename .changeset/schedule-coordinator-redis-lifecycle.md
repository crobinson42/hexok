---
"@hexok/schedule-coordinator-redis": minor
---

`RedisScheduleCoordinator` runs on `@hexok/ioredis-lifecycle`. It has the same lifecycle, error codes, and log fields as the other Redis adapters.

- `start()` resolves once Redis is ready. Connection errors go to the `logger`, and ioredis no longer prints "Unhandled error event".
- `startTimeoutMs` makes `start()` reject with `StartTimeout` when Redis is not ready in time. It is unset by default, so `start()` waits.
- `stopTimeoutMs` bounds all of `stop()`, even when Redis is unreachable. It defaults to 5000. A lock `stop()` cannot release expires after `lockTtlSec`.
- A lock command queued during an outage settles on `stop()` and is logged with `StoppedBeforeReply`. Before, it never settled.
- `state` returns the lifecycle state, such as `ready`. Use it to gate traffic during startup and shutdown.
- `LifecycleError` and the `LifecycleState` type are exported from this package. `LogSink` is the lifecycle's type.

Upgrade notes:

- `stop()` now waits for running ticks, up to `stopTimeoutMs`, before it releases their locks. Ticks keep renewing while they wind down, so no other process runs the job until they finish. Before, `stop()` released the locks at once. A tick that ignores its signal holds `stop()` until `stopTimeoutMs`.
- Renews go out every third of `lockTtlSec`, not every half. A tick whose lock is not renewed in time aborts a margin of `min(1000, TTL / 4)` ms before the lock can expire. Before, a renew that never answered did not abort the tick.
- Each acquisition writes its own random token as the lock value, instead of one id per coordinator. A late renew or release from an earlier tick no longer acts on a later lock.
- `register()` throws a `LifecycleError` with code `NotStarted`, `Starting`, or `Stopped`. Branch on `code`, not on the message. The old message `schedule: start() was not called` is gone.
- `stop()` forgets registered jobs. Register them again after the next `start()`. Before, registering the same name after a restart threw.
- Log fields are `{ adapter: 'schedule', job }`. `connection: 'commands'` is added only when a Redis command or connection failed. The old `name` field is now `job`. A `StoppedBeforeReply` is logged at `warn`. Lock loss and an unrenewed lock are logged at `warn`.
- `CronScheduler.stop()` may return a promise that resolves once a running tick has finished. `CronPackageScheduler` returns one. A custom scheduler that returns `void` still works.

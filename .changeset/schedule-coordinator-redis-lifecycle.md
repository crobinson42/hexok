---
"@hexok/schedule-coordinator-redis": minor
---

`RedisScheduleCoordinator` runs on `@hexok/ioredis-lifecycle`, like the other Redis adapters. `start()` resolves once Redis is ready, and connection errors go to the `logger`. `stop()` releases held locks, waits for running ticks, and resolves within `stopTimeoutMs` (default 5000) even when Redis is unreachable. A lock it cannot release expires after `lockTtlSec`. Once `stop()` begins, a running tick sends nothing more to Redis. A renew that has not answered by the next renew aborts the tick. `start()` works again after `stop()`. The new `state` getter suits a readiness or health check. `LifecycleError` and the `LifecycleState` type are exported.

Upgrade notes:

- `register()` throws a `LifecycleError` with code `NotStarted`, `Starting`, or `Stopped` instead of `schedule: start() was not called`. Branch on `code`.
- Without `startTimeoutMs`, `start()` waits until Redis is ready. Set it to fail fast.
- Log fields are `{ adapter: 'schedule', connection: 'commands', job }`. The `name` field is now `job`.
- `CronScheduler.stop()` may return a promise that resolves once a running tick has finished. `CronPackageScheduler` returns one. A custom scheduler that returns `void` still works.
- `stop()` forgets registered jobs. Register them again after the next `start()`.

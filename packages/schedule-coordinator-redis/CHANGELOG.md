# @hexok/schedule-coordinator-redis

## 1.0.0

### Major Changes

- [`9e42ece`](https://github.com/crobinson42/hexok/commit/9e42eced138949d2f17d3a49c0fa5cc51f2b19c5) Thanks [@crobinson42](https://github.com/crobinson42)! - Require `ioredis` 6. Connections negotiate RESP3 and keep v5 reply shapes. `@hexok/ioredis-lifecycle` no longer accepts `ioredis` 5.

### Patch Changes

- Updated dependencies [[`9e42ece`](https://github.com/crobinson42/hexok/commit/9e42eced138949d2f17d3a49c0fa5cc51f2b19c5), [`091523f`](https://github.com/crobinson42/hexok/commit/091523f4119b6ebff19cd1d72ee61cd26c0ed985)]:
  - @hexok/ioredis-lifecycle@1.0.0
  - hexok@2.2.2

## 0.2.0

### Minor Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`d356239`](https://github.com/crobinson42/hexok/commit/d3562394c485ac222b32c0ce14b2ec7edea968a9) Thanks [@crobinson42](https://github.com/crobinson42)! - `RedisScheduleCoordinator` runs on `@hexok/ioredis-lifecycle`. It has the same lifecycle, error codes, and log fields as the other Redis adapters.

  - `start()` resolves once Redis is ready. Connection errors go to the `logger`, and ioredis no longer prints "Unhandled error event".
  - `startTimeoutMs` makes `start()` reject with `StartTimeout` when Redis is not ready in time. It is unset by default, so `start()` waits.
  - `stopTimeoutMs` bounds all of `stop()`, even when Redis is unreachable. It defaults to 5000. A lock `stop()` cannot release expires after `lockTtlSec`.
  - A lock command queued during an outage settles on `stop()` and is logged with `StoppedBeforeReply`. Before, it never settled.
  - `state` returns the lifecycle state, such as `ready`. Use it to gate traffic during startup and shutdown.
  - `LifecycleError` and the `LifecycleState` type are exported from this package. `LogSink` is the lifecycle's type.

  Upgrade notes:

  - `stop()` now waits for running ticks, up to `stopTimeoutMs`, before it releases their locks. Ticks keep renewing while they wind down, so no other process runs the job until they finish. Before, `stop()` released the locks at once. A tick that ignores its signal holds `stop()` until `stopTimeoutMs`.
  - Renews go out every third of `lockTtlSec`, not every half. A tick whose lock is not renewed in time aborts a margin of `min(1000, TTL / 4)` ms before the lock can expire. Before, a renew that never answered did not abort the tick. A lock `SET` answered after that point, such as after an outage, releases the lock and skips `onTick`.
  - Each acquisition writes its own random token as the lock value, instead of one id per coordinator. A late renew or release from an earlier tick no longer acts on a later lock.
  - `register()` throws a `LifecycleError` with code `NotStarted`, `Starting`, or `Stopped`. Branch on `code`, not on the message. The old message `schedule: start() was not called` is gone.
  - `stop()` forgets registered jobs. Register them again after the next `start()`. Before, registering the same name after a restart threw.
  - Log fields are `{ adapter: 'schedule', job }`. `connection: 'commands'` is added only when a Redis command or connection failed. The old `name` field is now `job`. A lock command that `stop()` cut short is logged at `warn` with `code: 'StoppedBeforeReply'` in its fields. Lock loss and an unrenewed lock are logged at `warn`.
  - `CronScheduler.stop()` may return a promise that resolves once a running tick has finished. `CronPackageScheduler` returns one. A custom scheduler that returns `void` still works.

### Patch Changes

- Updated dependencies [[`45b26c8`](https://github.com/crobinson42/hexok/commit/45b26c83eb06e4b1320f294e6f8fc430d432c992), [`e1f8069`](https://github.com/crobinson42/hexok/commit/e1f806987c22120e74d66c8f1d38e7a7dbffaa6e), [`ef5febe`](https://github.com/crobinson42/hexok/commit/ef5febef9cdb084c346ac4f34953f72cd030592d)]:
  - hexok@2.2.1
  - @hexok/ioredis-lifecycle@0.1.0

## 0.1.0

### Minor Changes

- [#5](https://github.com/crobinson42/hexok/pull/5) [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8) Thanks [@crobinson42](https://github.com/crobinson42)! - Initial 0.1.0 release of @hexok/schedule-coordinator-redis.

### Patch Changes

- Updated dependencies [[`11e10cd`](https://github.com/crobinson42/hexok/commit/11e10cd90b636215324f3f54c03acdd91a3da159), [`faf7f47`](https://github.com/crobinson42/hexok/commit/faf7f472b56ad6e2b1b17dac86908e20ee6540a6), [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8)]:
  - hexok@2.2.0
  - @hexok/schedule-coordinator@0.1.0

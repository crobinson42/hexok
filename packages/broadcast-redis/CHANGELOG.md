# @hexok/broadcast-redis

## 0.2.0

### Minor Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`2e268ba`](https://github.com/crobinson42/hexok/commit/2e268bacdb2b553d7d556a894be24a83de88fa1a) Thanks [@crobinson42](https://github.com/crobinson42)! - `RedisBroadcast` runs on `@hexok/ioredis-lifecycle`, the lifecycle every hexok Redis adapter shares. `stop()` resolves within `stopTimeoutMs`, even when Redis is unreachable. A `publish()` or `subscribe()` still pending when `stop()` stops waiting rejects with `StoppedBeforeReply`.

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

### Patch Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`361dc33`](https://github.com/crobinson42/hexok/commit/361dc337e86f612b07b4a6d1df04c2d48483921f) Thanks [@crobinson42](https://github.com/crobinson42)! - `RedisBroadcast.start()` resolves once the publisher and the subscriber are ready. Connection errors go to the `LogSink`. `start()` rejects when a connection ends or `stop()` is called first, and a later `start()` can retry. `subscribe` resolves only after Redis confirms `SUBSCRIBE`, even when another `subscribe` to the channel is pending. A failed `SUBSCRIBE` removes the channel's handlers. `stop()` does not wait on an unreachable Redis.

- Updated dependencies [[`45b26c8`](https://github.com/crobinson42/hexok/commit/45b26c83eb06e4b1320f294e6f8fc430d432c992), [`e1f8069`](https://github.com/crobinson42/hexok/commit/e1f806987c22120e74d66c8f1d38e7a7dbffaa6e), [`ef5febe`](https://github.com/crobinson42/hexok/commit/ef5febef9cdb084c346ac4f34953f72cd030592d)]:
  - hexok@2.2.1
  - @hexok/ioredis-lifecycle@0.1.0

## 0.1.0

### Minor Changes

- [#5](https://github.com/crobinson42/hexok/pull/5) [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8) Thanks [@crobinson42](https://github.com/crobinson42)! - Initial 0.1.0 release of @hexok/broadcast-redis.

### Patch Changes

- Updated dependencies [[`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8), [`11e10cd`](https://github.com/crobinson42/hexok/commit/11e10cd90b636215324f3f54c03acdd91a3da159), [`faf7f47`](https://github.com/crobinson42/hexok/commit/faf7f472b56ad6e2b1b17dac86908e20ee6540a6)]:
  - @hexok/broadcast@0.1.0
  - hexok@2.2.0

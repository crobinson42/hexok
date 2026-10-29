# @hexok/ioredis-lifecycle

## 1.0.0

### Major Changes

- [`9e42ece`](https://github.com/crobinson42/hexok/commit/9e42eced138949d2f17d3a49c0fa5cc51f2b19c5) Thanks [@crobinson42](https://github.com/crobinson42)! - Require `ioredis` 6. Connections negotiate RESP3 and keep v5 reply shapes. `@hexok/ioredis-lifecycle` no longer accepts `ioredis` 5.

### Patch Changes

- Updated dependencies [[`091523f`](https://github.com/crobinson42/hexok/commit/091523f4119b6ebff19cd1d72ee61cd26c0ed985)]:
  - hexok@2.2.2

## 0.1.0

### Minor Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`e1f8069`](https://github.com/crobinson42/hexok/commit/e1f806987c22120e74d66c8f1d38e7a7dbffaa6e) Thanks [@crobinson42](https://github.com/crobinson42)! - Initial release of `@hexok/ioredis-lifecycle`, the shared ioredis connection lifecycle for hexok Redis adapters. `RedisLifecycle` waits for every client to be ready on `start()`, logs every client error, guards each command by state, and makes `stop()` finish within `stopTimeoutMs` even when Redis is unreachable. A command still pending when `stop()` stops waiting rejects with `StoppedBeforeReply`. Errors are a `LifecycleError` catalog matched on `code`. A client that ends after `start()` is logged at `error`. Also exports `openRedis`, `sleep`, and the `LogSink` type.

### Patch Changes

- Updated dependencies [[`45b26c8`](https://github.com/crobinson42/hexok/commit/45b26c83eb06e4b1320f294e6f8fc430d432c992), [`ef5febe`](https://github.com/crobinson42/hexok/commit/ef5febef9cdb084c346ac4f34953f72cd030592d)]:
  - hexok@2.2.1

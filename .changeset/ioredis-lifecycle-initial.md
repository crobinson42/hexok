---
"@hexok/ioredis-lifecycle": minor
---

Initial release of `@hexok/ioredis-lifecycle`, the shared ioredis connection lifecycle for hexok Redis adapters. `RedisLifecycle` waits for every client to be ready on `start()`, logs every client error, guards each command by state, and makes `stop()` finish within `stopTimeoutMs` even when Redis is unreachable. A command still pending when `stop()` stops waiting rejects with `StoppedBeforeReply`. Errors are a `LifecycleError` catalog matched on `code`. Also exports `openRedis`, `settleWithin`, `sleep`, and the `LogSink` type.
